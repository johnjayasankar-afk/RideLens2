/**
 * Lyft direct quote adapter.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ACCESS STATUS (verified 2026-09-03)                                      │
 * │ Lyft's public developer programme is closed: developer.lyft.com no       │
 * │ longer accepts new applications, and the official Lyft Go and Node SDKs  │
 * │ are marked deprecated and unsupported. There is no self-serve route to a │
 * │ Lyft cost-estimate credential today.                                     │
 * │                                                                          │
 * │ Third-party "Lyft data" resellers that scrape the consumer surface are   │
 * │ NOT used here — they are unauthorized access and are out of scope by     │
 * │ policy, not merely by preference.                                        │
 * │                                                                          │
 * │ The adapter is implemented against the documented /v1/cost and /v1/eta   │
 * │ contract so that a partner credential activates it with configuration    │
 * │ alone. Lyft coverage otherwise comes from the licensed aggregation feed. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { z } from 'zod';
import { getConfig } from '@/config/env';
import { computeFreshness } from '@/domain/freshness';
import { quoteKey } from '@/domain/ids';
import { isIso4217, midpointMinor } from '@/domain/money';
import type { NormalizedQuote, PriceType } from '@/domain/quote';
import { categorizeProduct } from '@/domain/taxonomy';
import { confidenceFor } from '@/domain/uncertainty';
import { resolveBookingHandoff } from '@/booking/resolver';
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

const DEFAULT_BASE_URL = 'https://api.lyft.com';

/**
 * Lyft's cost endpoint reports money in MINOR UNITS already
 * (estimated_cost_cents_min / _max), so these never go through majorToMinor.
 */
export const LyftCostSchema = z.object({
  cost_estimates: z.array(
    z.object({
      ride_type: z.string(),
      display_name: z.string(),
      currency: z.string(),
      estimated_cost_cents_min: z.number(),
      estimated_cost_cents_max: z.number(),
      estimated_duration_seconds: z.number().nullish(),
      estimated_distance_miles: z.number().nullish(),
      primetime_percentage: z.string().nullish(),
      is_valid_estimate: z.boolean().nullish(),
    }),
  ),
});

const LyftEtaSchema = z.object({
  eta_estimates: z.array(
    z.object({
      ride_type: z.string(),
      eta_seconds: z.number().nullish(),
      is_valid_estimate: z.boolean().nullish(),
    }),
  ),
});

const METERS_PER_MILE = 1609.344;

export class LyftAuthorizedQuoteSource implements QuoteSource {
  capabilities(): SourceCapabilities {
    return {
      sourceId: 'lyft_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      displayName: 'Lyft (direct, authorized)',
      providers: ['lyft'],
      supportsPrice: true,
      supportsUpfront: false,
      supportsETA: true,
      supportsBooking: true,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ['US', 'CA'],
      cacheTtlSeconds: Math.min(getConfig().QUOTE_CACHE_TTL_SECONDS, 30),
      rateLimit: { requestsPerMinute: 60, burst: 10 },
    };
  }

  enablement(): SourceEnablement {
    const cfg = getConfig();
    if (!cfg.LYFT_CLIENT_ID || !cfg.LYFT_CLIENT_SECRET) {
      return {
        enabled: false,
        blockerCode: 'NO_PUBLIC_ENDPOINT',
        blockerMessage:
          "Lyft's public developer programme is closed and no new API credentials can be created. This adapter activates only under a Lyft partner agreement. Lyft coverage is served through the licensed aggregation feed.",
        requiredEnv: ['LYFT_CLIENT_ID', 'LYFT_CLIENT_SECRET', 'LYFT_API_BASE_URL'],
      };
    }
    return { enabled: true, blockerCode: null, blockerMessage: null, requiredEnv: [] };
  }

  private baseUrl(): string {
    return getConfig().LYFT_API_BASE_URL ?? DEFAULT_BASE_URL;
  }

  /** Client-credentials grant; tokens are held in memory only. */
  private token: { value: string; expiresAt: number } | null = null;

  private async accessToken(timeoutMs: number): Promise<string> {
    const cfg = getConfig();
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;

    const host = new URL(this.baseUrl()).hostname;
    const basic = Buffer.from(`${cfg.LYFT_CLIENT_ID}:${cfg.LYFT_CLIENT_SECRET}`).toString('base64');
    const res = await httpJson<{ access_token?: string; expires_in?: number }>(
      new URL('/oauth/token', this.baseUrl()).toString(),
      {
        method: 'POST',
        timeoutMs,
        allowedHosts: [host],
        headers: { Authorization: `Basic ${basic}` },
        body: { grant_type: 'client_credentials', scope: 'public' },
      },
    );
    if (!res.access_token)
      throw new SourceError('Lyft returned no token.', 'lyft_direct', 'UNAUTHORIZED');
    this.token = {
      value: res.access_token,
      expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const gate = this.enablement();
    if (!gate.enabled) {
      throw new SourceError(gate.blockerMessage ?? 'Disabled.', 'lyft_direct', 'DISABLED');
    }

    const started = Date.now();
    const host = new URL(this.baseUrl()).hostname;
    let token: string;
    try {
      token = await this.accessToken(Math.min(4000, request.timeoutMs));
    } catch (err) {
      throw toSourceError(err);
    }

    const costUrl = new URL('/v1/cost', this.baseUrl());
    costUrl.searchParams.set('start_lat', String(request.pickup.lat));
    costUrl.searchParams.set('start_lng', String(request.pickup.lng));
    costUrl.searchParams.set('end_lat', String(request.destination.lat));
    costUrl.searchParams.set('end_lng', String(request.destination.lng));

    const etaUrl = new URL('/v1/eta', this.baseUrl());
    etaUrl.searchParams.set('lat', String(request.pickup.lat));
    etaUrl.searchParams.set('lng', String(request.pickup.lng));

    const opts = {
      timeoutMs: request.timeoutMs,
      allowedHosts: [host],
      headers: { Authorization: `Bearer ${token}` },
      signal: request.signal,
    };

    const [costRaw, etaRaw] = await Promise.all([
      httpJson(costUrl.toString(), opts).catch((e: unknown) => {
        throw toSourceError(e);
      }),
      httpJson(etaUrl.toString(), opts).catch(() => null),
    ]);

    const cost = LyftCostSchema.safeParse(costRaw);
    if (!cost.success) {
      throw new SourceError('Lyft cost response failed validation.', 'lyft_direct', 'SCHEMA');
    }
    const eta = LyftEtaSchema.safeParse(etaRaw);
    const etaByType = new Map<string, number>(
      eta.success
        ? eta.data.eta_estimates.flatMap((e) =>
            typeof e.eta_seconds === 'number' ? [[e.ride_type, e.eta_seconds] as const] : [],
          )
        : [],
    );

    const now = Date.now();
    const receivedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.capabilities().cacheTtlSeconds * 1000).toISOString();

    const quotes: NormalizedQuote[] = [];
    for (const c of cost.data.cost_estimates) {
      if (c.is_valid_estimate === false) continue;
      const currency = c.currency.toUpperCase();
      if (!isIso4217(currency)) continue;

      // Already minor units — do not re-scale.
      const minMinor = Math.round(c.estimated_cost_cents_min);
      const maxMinor = Math.round(c.estimated_cost_cents_max);
      const priceType: PriceType = minMinor === maxMinor ? 'ESTIMATE' : 'ESTIMATE_RANGE';

      quotes.push({
        id: quoteKey({ source: 'lyft_direct', provider: 'lyft', providerProductId: c.ride_type }),
        provider: 'lyft',
        providerProductId: c.ride_type,
        providerProductName: c.display_name,
        normalizedCategory: categorizeProduct({
          provider: 'lyft',
          productId: c.ride_type,
          productName: c.display_name,
        }),
        priceType,
        priceMinMinor: Math.min(minMinor, maxMinor),
        priceMaxMinor: Math.max(minMinor, maxMinor),
        displayPriceMinor: Math.min(minMinor, maxMinor),
        rankingPriceMinor:
          priceType === 'ESTIMATE_RANGE' ? midpointMinor(minMinor, maxMinor) : minMinor,
        currency,
        pickupEtaSeconds: etaByType.get(c.ride_type) ?? null,
        tripDurationSeconds:
          typeof c.estimated_duration_seconds === 'number' ? c.estimated_duration_seconds : null,
        distanceMeters:
          typeof c.estimated_distance_miles === 'number'
            ? Math.round(c.estimated_distance_miles * METERS_PER_MILE)
            : null,
        availability: 'AVAILABLE',
        source: 'lyft_direct',
        sourceMethod: 'DIRECT_PARTNER_API',
        accountContext: 'PUBLIC',
        receivedAt,
        providerTimestamp: null,
        expiresAt,
        freshness: computeFreshness(receivedAt, expiresAt, now),
        scheduledFor: null,
        bookingHandoff: resolveBookingHandoff({
          provider: 'lyft',
          pickup: request.pickup,
          destination: request.destination,
          providerProductId: c.ride_type,
          sourceSuppliedUrl: null,
        }),
        confidenceClass: confidenceFor(priceType, minMinor, maxMinor),
        metadata: { primetimePercentage: c.primetime_percentage ?? null },
      });
    }

    return {
      sourceId: 'lyft_direct',
      quotes,
      providersAttempted: ['lyft'],
      fetchedAt: receivedAt,
      latencyMs: now - started,
      warnings: eta.success ? [] : ['Lyft ETA call failed; pickup times omitted.'],
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const gate = this.enablement();
    return {
      sourceId: 'lyft_direct',
      status: gate.enabled ? 'HEALTHY' : 'NOT_CONFIGURED',
      detail: gate.blockerMessage ?? 'Partner credentials configured.',
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      blockerCode: gate.blockerCode,
    };
  }
}

function toSourceError(err: unknown): SourceError {
  if (err instanceof SourceError) return err;
  if (err instanceof HttpError) {
    if (err.kind === 'TIMEOUT') return new SourceError(err.message, 'lyft_direct', 'TIMEOUT');
    if (err.status === 401 || err.status === 403) {
      return new SourceError('Lyft rejected the credential.', 'lyft_direct', 'UNAUTHORIZED');
    }
    if (err.status === 429)
      return new SourceError('Lyft rate limit reached.', 'lyft_direct', 'RATE_LIMITED');
  }
  return new SourceError(
    err instanceof Error ? err.message : 'Unknown failure',
    'lyft_direct',
    'UPSTREAM',
  );
}
