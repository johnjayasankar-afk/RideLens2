/**
 * Uber direct quote adapter.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ POLICY GATE — READ BEFORE ENABLING                                       │
 * │ Uber's API Terms of Use §II B prohibit using the Uber API in an          │
 * │ application that compares Uber against competing services. Uber's own    │
 * │ price-estimate documentation states that offering price comparisons with │
 * │ competitive third-party services violates those terms, and access to the │
 * │ endpoint additionally requires approval from an Uber business contact.   │
 * │                                                                          │
 * │ RideLens is exactly such a comparison product. This adapter is therefore │
 * │ implemented in full but refuses to run unless an operator asserts, in    │
 * │ configuration, that they hold a written agreement granting comparison    │
 * │ rights: UBER_COMPARISON_RIGHTS_GRANTED=true plus credentials.            │
 * │                                                                          │
 * │ The supported Uber path for RideLens is the licensed aggregation feed.   │
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

const HOST = 'api.uber.com';

/** Documented shape of GET /v1.2/estimates/price. */
export const UberPriceEstimateSchema = z.object({
  prices: z.array(
    z.object({
      product_id: z.string(),
      display_name: z.string(),
      localized_display_name: z.string().nullish(),
      estimate: z.string().nullish(),
      low_estimate: z.number().nullish(),
      high_estimate: z.number().nullish(),
      currency_code: z.string().nullish(),
      duration: z.number().nullish(),
      distance: z.number().nullish(),
      surge_multiplier: z.number().nullish(),
    }),
  ),
});

const UberTimeEstimateSchema = z.object({
  times: z.array(z.object({ product_id: z.string(), estimate: z.number() })),
});

/** Uber reports distance in miles. */
const METERS_PER_MILE = 1609.344;

export class UberAuthorizedQuoteSource implements QuoteSource {
  capabilities(): SourceCapabilities {
    return {
      sourceId: 'uber_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      displayName: 'Uber (direct, authorized)',
      providers: ['uber'],
      supportsPrice: true,
      // The estimates endpoint returns a range, not a bookable upfront fare.
      supportsUpfront: false,
      supportsETA: true,
      supportsBooking: true,
      supportsAccountLink: true,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ['*'],
      cacheTtlSeconds: Math.min(getConfig().QUOTE_CACHE_TTL_SECONDS, 30),
      rateLimit: { requestsPerMinute: 60, burst: 10 },
    };
  }

  enablement(): SourceEnablement {
    const cfg = getConfig();
    if (cfg.UBER_COMPARISON_RIGHTS_GRANTED !== 'true') {
      return {
        enabled: false,
        blockerCode: 'POLICY_PROHIBITED',
        blockerMessage:
          "Uber's API Terms of Use §II B prohibit competitive price comparison. This adapter stays off unless the operator holds a written agreement granting those rights and sets UBER_COMPARISON_RIGHTS_GRANTED=true. Uber coverage is served through the licensed aggregation feed instead.",
        requiredEnv: ['UBER_COMPARISON_RIGHTS_GRANTED', 'UBER_SERVER_TOKEN'],
      };
    }
    if (!cfg.UBER_SERVER_TOKEN && !cfg.UBER_CLIENT_SECRET) {
      return {
        enabled: false,
        blockerCode: 'MISSING_CREDENTIAL',
        blockerMessage: 'Comparison rights asserted but no Uber credential is configured.',
        requiredEnv: ['UBER_SERVER_TOKEN'],
      };
    }
    return { enabled: true, blockerCode: null, blockerMessage: null, requiredEnv: [] };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const cfg = getConfig();
    const gate = this.enablement();
    if (!gate.enabled) {
      throw new SourceError(gate.blockerMessage ?? 'Disabled.', 'uber_direct', 'DISABLED');
    }

    const started = Date.now();
    const linked = request.accountLinks?.uber?.accessToken;
    const authorization = linked ? `Bearer ${linked}` : `Token ${cfg.UBER_SERVER_TOKEN}`;

    const priceUrl = new URL(`https://${HOST}/v1.2/estimates/price`);
    priceUrl.searchParams.set('start_latitude', String(request.pickup.lat));
    priceUrl.searchParams.set('start_longitude', String(request.pickup.lng));
    priceUrl.searchParams.set('end_latitude', String(request.destination.lat));
    priceUrl.searchParams.set('end_longitude', String(request.destination.lng));

    const timeUrl = new URL(`https://${HOST}/v1.2/estimates/time`);
    timeUrl.searchParams.set('start_latitude', String(request.pickup.lat));
    timeUrl.searchParams.set('start_longitude', String(request.pickup.lng));

    const opts = {
      timeoutMs: request.timeoutMs,
      allowedHosts: [HOST],
      headers: { Authorization: authorization, 'Accept-Language': request.locale },
      signal: request.signal,
    };

    // Price and ETA are independent calls — issue them together, never serially.
    const [priceRaw, timeRaw] = await Promise.all([
      httpJson(priceUrl.toString(), opts).catch((e: unknown) => {
        throw toSourceError(e);
      }),
      httpJson(timeUrl.toString(), opts).catch(() => null),
    ]);

    const prices = UberPriceEstimateSchema.safeParse(priceRaw);
    if (!prices.success) {
      throw new SourceError('Uber price response failed validation.', 'uber_direct', 'SCHEMA');
    }
    const times = UberTimeEstimateSchema.safeParse(timeRaw);
    const etaByProduct = new Map<string, number>(
      times.success ? times.data.times.map((t) => [t.product_id, t.estimate]) : [],
    );

    const now = Date.now();
    const receivedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.capabilities().cacheTtlSeconds * 1000).toISOString();
    const accountContext = linked ? ('ACCOUNT_LINKED' as const) : ('PUBLIC' as const);

    const quotes: NormalizedQuote[] = [];
    for (const p of prices.data.prices) {
      const currency = (p.currency_code ?? '').toUpperCase();
      if (!isIso4217(currency)) continue;

      let priceType: PriceType;
      let minMinor: number;
      let maxMinor: number;

      if (typeof p.low_estimate === 'number' && typeof p.high_estimate === 'number') {
        minMinor = majorToMinor(p.low_estimate, currency);
        maxMinor = majorToMinor(p.high_estimate, currency);
        // Uber returns low === high for some products; that is still an
        // estimate, not a fare Uber has committed to honour.
        priceType = minMinor === maxMinor ? 'ESTIMATE' : 'ESTIMATE_RANGE';
      } else if (typeof p.estimate === 'string' && /\d/.test(p.estimate)) {
        // "Metered" for taxi products; a currency-formatted string otherwise.
        if (/metered/i.test(p.estimate)) continue;
        minMinor = maxMinor = majorToMinor(p.estimate, currency);
        priceType = 'ESTIMATE';
      } else {
        continue;
      }

      const productName = p.localized_display_name ?? p.display_name;
      quotes.push({
        id: quoteKey({ source: 'uber_direct', provider: 'uber', providerProductId: p.product_id }),
        provider: 'uber',
        providerProductId: p.product_id,
        providerProductName: productName,
        normalizedCategory: categorizeProduct({
          provider: 'uber',
          productId: p.product_id,
          productName,
        }),
        priceType,
        priceMinMinor: minMinor,
        priceMaxMinor: maxMinor,
        displayPriceMinor: minMinor,
        rankingPriceMinor:
          priceType === 'ESTIMATE_RANGE' ? midpointMinor(minMinor, maxMinor) : minMinor,
        currency,
        pickupEtaSeconds: etaByProduct.get(p.product_id) ?? null,
        tripDurationSeconds: typeof p.duration === 'number' ? p.duration : null,
        distanceMeters:
          typeof p.distance === 'number' ? Math.round(p.distance * METERS_PER_MILE) : null,
        availability: 'AVAILABLE',
        source: 'uber_direct',
        sourceMethod: 'DIRECT_PARTNER_API',
        accountContext,
        receivedAt,
        providerTimestamp: null,
        expiresAt,
        freshness: computeFreshness(receivedAt, expiresAt, now),
        scheduledFor: null,
        bookingHandoff: resolveBookingHandoff({
          provider: 'uber',
          pickup: request.pickup,
          destination: request.destination,
          providerProductId: p.product_id,
          sourceSuppliedUrl: null,
        }),
        confidenceClass: confidenceFor(priceType, minMinor, maxMinor),
        metadata: {
          surgeMultiplier: typeof p.surge_multiplier === 'number' ? p.surge_multiplier : null,
        },
      });
    }

    return {
      sourceId: 'uber_direct',
      quotes,
      providersAttempted: ['uber'],
      fetchedAt: receivedAt,
      latencyMs: now - started,
      warnings: times.success ? [] : ['Uber ETA call failed; pickup times omitted.'],
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const gate = this.enablement();
    return {
      sourceId: 'uber_direct',
      status: gate.enabled
        ? 'HEALTHY'
        : gate.blockerCode === 'POLICY_PROHIBITED'
          ? 'BLOCKED_BY_POLICY'
          : 'NOT_CONFIGURED',
      detail: gate.blockerMessage ?? 'Credentials present and comparison rights asserted.',
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      blockerCode: gate.blockerCode,
    };
  }
}

function toSourceError(err: unknown): SourceError {
  if (err instanceof HttpError) {
    if (err.kind === 'TIMEOUT') return new SourceError(err.message, 'uber_direct', 'TIMEOUT');
    if (err.status === 401 || err.status === 403) {
      return new SourceError('Uber rejected the credential.', 'uber_direct', 'UNAUTHORIZED');
    }
    if (err.status === 429)
      return new SourceError('Uber rate limit reached.', 'uber_direct', 'RATE_LIMITED');
  }
  return new SourceError(
    err instanceof Error ? err.message : 'Unknown failure',
    'uber_direct',
    'UPSTREAM',
  );
}
