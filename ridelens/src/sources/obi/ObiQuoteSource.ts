/**
 * Obi Intelligent Pricing API adapter — RideLens's primary multi-provider feed.
 *
 * Obi operates a licensed real-time comparison product spanning Uber, Lyft,
 * Curb, Waymo and others, and licenses that feed commercially. Routing our
 * Uber and Lyft coverage through Obi is a deliberate architectural choice: it
 * is the path that does not require us to hold rights Uber's and Lyft's own
 * developer terms do not grant (see docs/DATA_SOURCE_MATRIX.md).
 *
 * ACCESS: commercial agreement + OBI_API_KEY. Until then this source reports
 * itself NOT_CONFIGURED and RideLens surfaces no Obi-backed provider.
 * NOTHING here falls back to sample data.
 */
import { getConfig } from '@/config/env';
import type { ProviderId } from '@/domain/quote';
import { httpJson, HttpError } from '../http';
import type {
  QuoteRequest,
  QuoteSource,
  SourceCapabilities,
  SourceEnablement,
  SourceHealth,
  SourceQuoteResult,
} from '../types';
import { SourceError } from '../types';
import { normalizeObiResponse } from './normalize';
import { ObiQuoteResponseSchema } from './schema';

const DEFAULT_BASE_URL = 'https://api.rideobi.com';

export class ObiQuoteSource implements QuoteSource {
  capabilities(): SourceCapabilities {
    return {
      sourceId: 'obi',
      sourceMethod: 'AGGREGATOR_API',
      displayName: 'Obi Intelligent Pricing',
      providers: ['uber', 'lyft', 'empower', 'curb', 'waymo'],
      supportsPrice: true,
      supportsUpfront: true,
      supportsETA: true,
      supportsBooking: true,
      // Contracted separately; we do not assume it.
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ['*'],
      cacheTtlSeconds: getConfig().QUOTE_CACHE_TTL_SECONDS,
      rateLimit: null,
    };
  }

  enablement(): SourceEnablement {
    const cfg = getConfig();
    if (!cfg.OBI_API_KEY) {
      return {
        enabled: false,
        blockerCode: 'PARTNER_APPROVAL_REQUIRED',
        blockerMessage:
          'Obi Intelligent Pricing requires a commercial agreement and an API key. See SETUP_REQUIRED.md §Obi.',
        requiredEnv: ['OBI_API_KEY', 'OBI_API_BASE_URL'],
      };
    }
    return { enabled: true, blockerCode: null, blockerMessage: null, requiredEnv: [] };
  }

  private baseUrl(): string {
    return getConfig().OBI_API_BASE_URL ?? DEFAULT_BASE_URL;
  }

  private allowedHosts(): string[] {
    return [new URL(this.baseUrl()).hostname];
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const cfg = getConfig();
    const gate = this.enablement();
    if (!gate.enabled) {
      throw new SourceError(gate.blockerMessage ?? 'Obi is not configured.', 'obi', 'DISABLED');
    }

    const started = Date.now();
    const url = new URL('/v1/quotes', this.baseUrl());

    let raw: unknown;
    try {
      raw = await httpJson(url.toString(), {
        method: 'POST',
        timeoutMs: request.timeoutMs,
        allowedHosts: this.allowedHosts(),
        headers: { Authorization: `Bearer ${cfg.OBI_API_KEY}` },
        body: {
          // Identical canonical coordinates go to every source — this is what
          // makes the comparison valid.
          pickup: { lat: request.pickup.lat, lng: request.pickup.lng },
          dropoff: { lat: request.destination.lat, lng: request.destination.lng },
          locale: request.locale,
        },
        signal: request.signal,
      });
    } catch (err) {
      throw toSourceError(err);
    }

    const parsed = ObiQuoteResponseSchema.safeParse(raw);
    if (!parsed.success) {
      // A malformed upstream payload is an error, never a reason to invent data.
      throw new SourceError(
        `Obi response failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        'obi',
        'SCHEMA',
      );
    }

    const now = Date.now();
    const receivedAt = new Date(now).toISOString();
    const { quotes, warnings } = normalizeObiResponse(parsed.data, {
      pickup: request.pickup,
      destination: request.destination,
      receivedAt,
      now,
      fallbackTtlSeconds: cfg.QUOTE_CACHE_TTL_SECONDS,
    });

    const providersAttempted = Array.from(new Set(quotes.map((q) => q.provider))) as ProviderId[];

    return {
      sourceId: 'obi',
      quotes,
      providersAttempted:
        providersAttempted.length > 0 ? providersAttempted : this.capabilities().providers,
      fetchedAt: receivedAt,
      latencyMs: now - started,
      warnings,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const gate = this.enablement();
    const checkedAt = new Date().toISOString();
    if (!gate.enabled) {
      return {
        sourceId: 'obi',
        status: 'NOT_CONFIGURED',
        detail: gate.blockerMessage ?? 'Not configured.',
        checkedAt,
        latencyMs: null,
        blockerCode: gate.blockerCode,
      };
    }

    const started = Date.now();
    try {
      await httpJson(new URL('/v1/health', this.baseUrl()).toString(), {
        timeoutMs: 4_000,
        allowedHosts: this.allowedHosts(),
        headers: { Authorization: `Bearer ${getConfig().OBI_API_KEY}` },
      });
      return {
        sourceId: 'obi',
        status: 'HEALTHY',
        detail: 'Live request succeeded.',
        checkedAt,
        latencyMs: Date.now() - started,
        blockerCode: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown failure';
      return {
        sourceId: 'obi',
        status: 'UNAVAILABLE',
        detail: message,
        checkedAt,
        latencyMs: Date.now() - started,
        blockerCode: null,
      };
    }
  }
}

function toSourceError(err: unknown): SourceError {
  if (err instanceof HttpError) {
    if (err.kind === 'TIMEOUT') return new SourceError(err.message, 'obi', 'TIMEOUT');
    if (err.status === 401 || err.status === 403) {
      return new SourceError('Obi rejected the API key.', 'obi', 'UNAUTHORIZED');
    }
    if (err.status === 429)
      return new SourceError('Obi rate limit reached.', 'obi', 'RATE_LIMITED');
    return new SourceError(err.message, 'obi', 'UPSTREAM');
  }
  return new SourceError(err instanceof Error ? err.message : 'Unknown failure', 'obi', 'UPSTREAM');
}
