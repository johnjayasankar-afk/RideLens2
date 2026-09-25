/**
 * Curb Flow adapter — licensed taxi supply.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ACCESS STATUS (verified 2026-09-03)                                      │
 * │ Curb Flow is a real B2B integration platform: it unifies street hails,   │
 * │ fleet dispatch, app bookings and third-party demand across 100+ US       │
 * │ cities, and Uber, Lyft and Ride Health are named integration partners.   │
 * │ It is NOT self-serve — access is granted through a partner agreement     │
 * │ arranged with Curb's business team.                                      │
 * │                                                                          │
 * │ Curb is the most promising DIRECT (non-aggregated) source for RideLens:  │
 * │ it is the one provider whose own platform is explicitly designed to      │
 * │ accept third-party ride demand, so a comparison product is a natural     │
 * │ fit rather than a terms conflict.                                        │
 * │                                                                          │
 * │ PRICE SEMANTICS: Curb offers upfront pricing in some markets and metered │
 * │ fares in others. We emit UPFRONT_QUOTE only when the payload says the    │
 * │ fare is upfront, and METERED_ESTIMATE otherwise. Category is always      │
 * │ TAXI — a regulated metered vehicle is a different product from an app    │
 * │ STANDARD car and is never folded into STANDARD.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { z } from 'zod';
import { getConfig } from '@/config/env';
import { computeFreshness } from '@/domain/freshness';
import { quoteKey } from '@/domain/ids';
import { isIso4217, majorToMinor, midpointMinor } from '@/domain/money';
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

const DEFAULT_BASE_URL = 'https://api.gocurb.com';

export const CurbQuoteSchema = z.object({
  quotes: z.array(
    z.object({
      service_id: z.string(),
      service_name: z.string(),
      currency: z.string(),
      /** Present for upfront markets. */
      upfront_fare: z.union([z.number(), z.string()]).nullish(),
      /** Present for metered markets. */
      estimated_fare_min: z.union([z.number(), z.string()]).nullish(),
      estimated_fare_max: z.union([z.number(), z.string()]).nullish(),
      fare_type: z.string().nullish(),
      pickup_eta_seconds: z.number().nullish(),
      trip_duration_seconds: z.number().nullish(),
      distance_meters: z.number().nullish(),
      available: z.boolean().nullish(),
      expires_at: z.string().nullish(),
      booking_url: z.string().nullish(),
      wheelchair_accessible: z.boolean().nullish(),
    }),
  ),
  generated_at: z.string().nullish(),
});

export class CurbFlowQuoteSource implements QuoteSource {
  capabilities(): SourceCapabilities {
    return {
      sourceId: 'curb_flow',
      sourceMethod: 'DIRECT_PARTNER_API',
      displayName: 'Curb Flow',
      providers: ['curb'],
      supportsPrice: true,
      supportsUpfront: true,
      supportsETA: true,
      supportsBooking: true,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: true,
      markets: ['US'],
      cacheTtlSeconds: Math.min(getConfig().QUOTE_CACHE_TTL_SECONDS, 30),
      rateLimit: { requestsPerMinute: 120, burst: 20 },
    };
  }

  enablement(): SourceEnablement {
    const cfg = getConfig();
    if (!cfg.CURB_API_KEY) {
      return {
        enabled: false,
        blockerCode: 'PARTNER_APPROVAL_REQUIRED',
        blockerMessage:
          'Curb Flow requires a partner agreement and API key from Curb. See SETUP_REQUIRED.md §Curb.',
        requiredEnv: ['CURB_API_KEY', 'CURB_API_BASE_URL'],
      };
    }
    return { enabled: true, blockerCode: null, blockerMessage: null, requiredEnv: [] };
  }

  private baseUrl(): string {
    return getConfig().CURB_API_BASE_URL ?? DEFAULT_BASE_URL;
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const cfg = getConfig();
    const gate = this.enablement();
    if (!gate.enabled) {
      throw new SourceError(gate.blockerMessage ?? 'Disabled.', 'curb_flow', 'DISABLED');
    }

    const host = new URL(this.baseUrl()).hostname;
    const started = Date.now();

    let raw: unknown;
    try {
      raw = await httpJson(new URL('/flow/v1/quotes', this.baseUrl()).toString(), {
        method: 'POST',
        timeoutMs: request.timeoutMs,
        allowedHosts: [host],
        headers: { Authorization: `Bearer ${cfg.CURB_API_KEY}` },
        body: {
          pickup: { latitude: request.pickup.lat, longitude: request.pickup.lng },
          dropoff: { latitude: request.destination.lat, longitude: request.destination.lng },
        },
        signal: request.signal,
      });
    } catch (err) {
      throw toSourceError(err);
    }

    const parsed = CurbQuoteSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SourceError('Curb response failed validation.', 'curb_flow', 'SCHEMA');
    }

    const now = Date.now();
    const receivedAt = new Date(now).toISOString();
    const quotes: NormalizedQuote[] = [];

    for (const q of parsed.data.quotes) {
      const currency = q.currency.toUpperCase();
      if (!isIso4217(currency)) continue;

      const price = extractCurbPrice(q, currency);
      if (!price) continue;

      const expiresAt =
        typeof q.expires_at === 'string'
          ? q.expires_at
          : new Date(now + this.capabilities().cacheTtlSeconds * 1000).toISOString();

      const category =
        q.wheelchair_accessible === true
          ? ('ACCESSIBLE' as const)
          : categorizeProduct({
              provider: 'curb',
              productId: q.service_id,
              productName: q.service_name,
            });

      quotes.push({
        id: quoteKey({ source: 'curb_flow', provider: 'curb', providerProductId: q.service_id }),
        provider: 'curb',
        providerProductId: q.service_id,
        providerProductName: q.service_name,
        normalizedCategory: category,
        priceType: price.priceType,
        priceMinMinor: price.minMinor,
        priceMaxMinor: price.maxMinor,
        displayPriceMinor: price.minMinor,
        rankingPriceMinor:
          price.priceType === 'ESTIMATE_RANGE'
            ? midpointMinor(price.minMinor, price.maxMinor)
            : price.minMinor,
        currency,
        pickupEtaSeconds: typeof q.pickup_eta_seconds === 'number' ? q.pickup_eta_seconds : null,
        tripDurationSeconds:
          typeof q.trip_duration_seconds === 'number' ? q.trip_duration_seconds : null,
        distanceMeters: typeof q.distance_meters === 'number' ? q.distance_meters : null,
        availability: q.available === false ? 'UNAVAILABLE' : 'AVAILABLE',
        source: 'curb_flow',
        sourceMethod: 'DIRECT_PARTNER_API',
        accountContext: 'PUBLIC',
        receivedAt,
        providerTimestamp: parsed.data.generated_at ?? null,
        expiresAt,
        freshness: computeFreshness(receivedAt, expiresAt, now),
        scheduledFor: null,
        bookingHandoff: resolveBookingHandoff({
          provider: 'curb',
          pickup: request.pickup,
          destination: request.destination,
          providerProductId: q.service_id,
          sourceSuppliedUrl: typeof q.booking_url === 'string' ? q.booking_url : null,
        }),
        confidenceClass: confidenceFor(price.priceType, price.minMinor, price.maxMinor),
        metadata: { fareType: q.fare_type ?? null },
      });
    }

    return {
      sourceId: 'curb_flow',
      quotes,
      providersAttempted: ['curb'],
      fetchedAt: receivedAt,
      latencyMs: now - started,
      warnings: [],
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const gate = this.enablement();
    const checkedAt = new Date().toISOString();
    if (!gate.enabled) {
      return {
        sourceId: 'curb_flow',
        status: 'NOT_CONFIGURED',
        detail: gate.blockerMessage ?? 'Not configured.',
        checkedAt,
        latencyMs: null,
        blockerCode: gate.blockerCode,
      };
    }
    const started = Date.now();
    try {
      await httpJson(new URL('/flow/v1/health', this.baseUrl()).toString(), {
        timeoutMs: 4_000,
        allowedHosts: [new URL(this.baseUrl()).hostname],
        headers: { Authorization: `Bearer ${getConfig().CURB_API_KEY}` },
      });
      return {
        sourceId: 'curb_flow',
        status: 'HEALTHY',
        detail: 'Live request succeeded.',
        checkedAt,
        latencyMs: Date.now() - started,
        blockerCode: null,
      };
    } catch (err) {
      return {
        sourceId: 'curb_flow',
        status: 'UNAVAILABLE',
        detail: err instanceof Error ? err.message : 'Unknown failure',
        checkedAt,
        latencyMs: Date.now() - started,
        blockerCode: null,
      };
    }
  }
}

interface CurbPrice {
  priceType: PriceType;
  minMinor: number;
  maxMinor: number;
}

/**
 * UPFRONT_QUOTE requires an explicit upfront fare in the payload. A metered
 * market yields METERED_ESTIMATE (point) or ESTIMATE_RANGE (band) — never
 * "upfront", because the meter, not this number, decides what the rider pays.
 */
function extractCurbPrice(
  q: z.infer<typeof CurbQuoteSchema>['quotes'][number],
  currency: string,
): CurbPrice | null {
  try {
    if (q.upfront_fare !== null && q.upfront_fare !== undefined) {
      const minor = majorToMinor(q.upfront_fare, currency);
      return { priceType: 'UPFRONT_QUOTE', minMinor: minor, maxMinor: minor };
    }
    const lo = q.estimated_fare_min;
    const hi = q.estimated_fare_max;
    if (lo !== null && lo !== undefined && hi !== null && hi !== undefined) {
      const a = majorToMinor(lo, currency);
      const b = majorToMinor(hi, currency);
      if (a === b) return { priceType: 'METERED_ESTIMATE', minMinor: a, maxMinor: a };
      return { priceType: 'ESTIMATE_RANGE', minMinor: Math.min(a, b), maxMinor: Math.max(a, b) };
    }
    if (lo !== null && lo !== undefined) {
      const a = majorToMinor(lo, currency);
      return { priceType: 'METERED_ESTIMATE', minMinor: a, maxMinor: a };
    }
  } catch {
    return null;
  }
  return null;
}

function toSourceError(err: unknown): SourceError {
  if (err instanceof HttpError) {
    if (err.kind === 'TIMEOUT') return new SourceError(err.message, 'curb_flow', 'TIMEOUT');
    if (err.status === 401 || err.status === 403) {
      return new SourceError('Curb rejected the credential.', 'curb_flow', 'UNAUTHORIZED');
    }
    if (err.status === 429)
      return new SourceError('Curb rate limit reached.', 'curb_flow', 'RATE_LIMITED');
  }
  return new SourceError(
    err instanceof Error ? err.message : 'Unknown failure',
    'curb_flow',
    'UPSTREAM',
  );
}
