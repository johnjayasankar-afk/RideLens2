/**
 * Empower direct quote adapter.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ACCESS STATUS (verified 2026-09-03)                                      │
 * │ Empower (the driver-owned rideshare platform, iOS/Android "Empower —     │
 * │ Your ride, your way") publishes no developer or partner API. There is no │
 * │ documented OAuth flow, quote endpoint, or booking deep link.             │
 * │                                                                          │
 * │ NOT TO BE CONFUSED WITH empower.com — Empower Retirement/Personal        │
 * │ Capital, a financial-services company whose public "APIs" pages are      │
 * │ entirely unrelated to rideshare. Do not wire those endpoints in here.    │
 * │                                                                          │
 * │ PRICE SEMANTICS: Empower is driver-priced. The number a rider sees       │
 * │ before a driver accepts is an ESTIMATE, never a locked fare. This        │
 * │ adapter therefore hard-codes ESTIMATE and refuses to emit UPFRONT_QUOTE  │
 * │ unless a future contract explicitly proves the fare is binding.          │
 * │                                                                          │
 * │ Empower coverage today comes from the licensed aggregation feed.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { z } from 'zod';
import { getConfig } from '@/config/env';
import { computeFreshness } from '@/domain/freshness';
import { quoteKey } from '@/domain/ids';
import { isIso4217, majorToMinor } from '@/domain/money';
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

export const EmpowerQuoteSchema = z.object({
  quotes: z.array(
    z.object({
      tier_id: z.string(),
      tier_name: z.string(),
      currency: z.string(),
      /** Decimal major units, e.g. 23.84. */
      estimated_fare: z.union([z.number(), z.string()]),
      /**
       * Present only if a contract ever guarantees the fare. Absent by default,
       * which keeps priceType at ESTIMATE.
       */
      fare_is_guaranteed: z.boolean().nullish(),
      eta_seconds: z.number().nullish(),
      available: z.boolean().nullish(),
      booking_url: z.string().nullish(),
    }),
  ),
});

export class EmpowerAuthorizedQuoteSource implements QuoteSource {
  capabilities(): SourceCapabilities {
    return {
      sourceId: 'empower_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      displayName: 'Empower (direct, authorized)',
      providers: ['empower'],
      supportsPrice: true,
      // Driver-priced marketplace: no upfront guarantee before assignment.
      supportsUpfront: false,
      supportsETA: true,
      supportsBooking: true,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ['US'],
      cacheTtlSeconds: Math.min(getConfig().QUOTE_CACHE_TTL_SECONDS, 30),
      rateLimit: null,
    };
  }

  enablement(): SourceEnablement {
    const cfg = getConfig();
    if (!cfg.EMPOWER_API_KEY || !cfg.EMPOWER_API_BASE_URL) {
      return {
        enabled: false,
        blockerCode: 'NO_PUBLIC_ENDPOINT',
        blockerMessage:
          'Empower publishes no developer or partner API. This adapter activates only if Empower grants a partner endpoint and key. Empower coverage is served through the licensed aggregation feed.',
        requiredEnv: ['EMPOWER_API_KEY', 'EMPOWER_API_BASE_URL'],
      };
    }
    return { enabled: true, blockerCode: null, blockerMessage: null, requiredEnv: [] };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const cfg = getConfig();
    const gate = this.enablement();
    if (!gate.enabled) {
      throw new SourceError(gate.blockerMessage ?? 'Disabled.', 'empower_direct', 'DISABLED');
    }

    const base = cfg.EMPOWER_API_BASE_URL as string;
    const host = new URL(base).hostname;
    const started = Date.now();

    let raw: unknown;
    try {
      raw = await httpJson(new URL('/v1/quotes', base).toString(), {
        method: 'POST',
        timeoutMs: request.timeoutMs,
        allowedHosts: [host],
        headers: { Authorization: `Bearer ${cfg.EMPOWER_API_KEY}` },
        body: {
          pickup: { lat: request.pickup.lat, lng: request.pickup.lng },
          dropoff: { lat: request.destination.lat, lng: request.destination.lng },
        },
        signal: request.signal,
      });
    } catch (err) {
      throw toSourceError(err);
    }

    const parsed = EmpowerQuoteSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SourceError('Empower response failed validation.', 'empower_direct', 'SCHEMA');
    }

    const now = Date.now();
    const receivedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.capabilities().cacheTtlSeconds * 1000).toISOString();

    const quotes: NormalizedQuote[] = [];
    for (const q of parsed.data.quotes) {
      const currency = q.currency.toUpperCase();
      if (!isIso4217(currency)) continue;
      let minor: number;
      try {
        minor = majorToMinor(q.estimated_fare, currency);
      } catch {
        continue;
      }

      // The ONLY route to UPFRONT_QUOTE is an explicit guarantee flag.
      const priceType: PriceType = q.fare_is_guaranteed === true ? 'UPFRONT_QUOTE' : 'ESTIMATE';

      quotes.push({
        id: quoteKey({
          source: 'empower_direct',
          provider: 'empower',
          providerProductId: q.tier_id,
        }),
        provider: 'empower',
        providerProductId: q.tier_id,
        providerProductName: q.tier_name,
        normalizedCategory: categorizeProduct({
          provider: 'empower',
          productId: q.tier_id,
          productName: q.tier_name,
        }),
        priceType,
        priceMinMinor: minor,
        priceMaxMinor: minor,
        displayPriceMinor: minor,
        rankingPriceMinor: minor,
        currency,
        pickupEtaSeconds: typeof q.eta_seconds === 'number' ? q.eta_seconds : null,
        tripDurationSeconds: null,
        distanceMeters: null,
        availability: q.available === false ? 'UNAVAILABLE' : 'AVAILABLE',
        source: 'empower_direct',
        sourceMethod: 'DIRECT_PARTNER_API',
        accountContext: 'PUBLIC',
        receivedAt,
        providerTimestamp: null,
        expiresAt,
        freshness: computeFreshness(receivedAt, expiresAt, now),
        scheduledFor: null,
        bookingHandoff: resolveBookingHandoff({
          provider: 'empower',
          pickup: request.pickup,
          destination: request.destination,
          providerProductId: q.tier_id,
          sourceSuppliedUrl: typeof q.booking_url === 'string' ? q.booking_url : null,
        }),
        confidenceClass: confidenceFor(priceType, minor, minor),
        metadata: { fareGuaranteed: q.fare_is_guaranteed ?? false },
      });
    }

    return {
      sourceId: 'empower_direct',
      quotes,
      providersAttempted: ['empower'],
      fetchedAt: receivedAt,
      latencyMs: now - started,
      warnings: [],
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const gate = this.enablement();
    return {
      sourceId: 'empower_direct',
      status: gate.enabled ? 'HEALTHY' : 'NOT_CONFIGURED',
      detail: gate.blockerMessage ?? 'Partner endpoint configured.',
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      blockerCode: gate.blockerCode,
    };
  }
}

function toSourceError(err: unknown): SourceError {
  if (err instanceof HttpError) {
    if (err.kind === 'TIMEOUT') return new SourceError(err.message, 'empower_direct', 'TIMEOUT');
    if (err.status === 401 || err.status === 403) {
      return new SourceError('Empower rejected the credential.', 'empower_direct', 'UNAUTHORIZED');
    }
  }
  return new SourceError(
    err instanceof Error ? err.message : 'Unknown failure',
    'empower_direct',
    'UPSTREAM',
  );
}
