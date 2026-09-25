/**
 * Obi payload -> NormalizedQuote.
 *
 * Every semantic decision is explicit and conservative: when Obi does not tell
 * us a price is upfront, we do not claim it is.
 */
import { majorToMinor, midpointMinor, isIso4217 } from '@/domain/money';
import { computeFreshness } from '@/domain/freshness';
import { quoteKey } from '@/domain/ids';
import type { Availability, NormalizedQuote, PriceType, ProviderId } from '@/domain/quote';
import { categorizeProduct } from '@/domain/taxonomy';
import { confidenceFor } from '@/domain/uncertainty';
import { resolveBookingHandoff } from '@/booking/resolver';
import type { CanonicalLocation } from '@/location/types';
import {
  extractProducts,
  OBI_PROVIDER_MAP,
  type ObiProduct,
  type ObiQuoteResponse,
} from './schema';

export interface ObiNormalizeContext {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  receivedAt: string;
  now: number;
  /** TTL used for expiry only when Obi supplies none. */
  fallbackTtlSeconds: number;
}

export function normalizeObiResponse(
  raw: ObiQuoteResponse,
  ctx: ObiNormalizeContext,
): { quotes: NormalizedQuote[]; warnings: string[] } {
  const warnings: string[] = [];
  const quotes: NormalizedQuote[] = [];

  for (const product of extractProducts(raw)) {
    const normalized = normalizeProduct(product, ctx, warnings);
    if (normalized) quotes.push(normalized);
  }

  if (quotes.length === 0 && warnings.length === 0) {
    warnings.push('Obi returned no priced products for this route.');
  }
  return { quotes, warnings };
}

function normalizeProduct(
  p: ObiProduct,
  ctx: ObiNormalizeContext,
  warnings: string[],
): NormalizedQuote | null {
  const providerRaw = String(p.provider ?? '')
    .trim()
    .toLowerCase();
  const provider = (OBI_PROVIDER_MAP[providerRaw] ?? 'other') as ProviderId;
  if (provider === 'other') {
    warnings.push(`Unmapped provider "${providerRaw}" surfaced as Other.`);
  }

  const currency = pickCurrency(p);
  if (!currency) {
    warnings.push(`Dropped ${providerRaw} product with no currency.`);
    return null;
  }

  const price = extractPrice(p, currency);
  if (!price) {
    warnings.push(`Dropped ${providerRaw} product with no usable price.`);
    return null;
  }

  const productId = String(p.product_id ?? p.id ?? `${providerRaw}-unknown`);
  const productName = String(p.product_name ?? p.name ?? p.display_name ?? productId);

  const pickupEtaSeconds = firstNumber(
    p.pickup_eta_seconds,
    p.eta_seconds,
    typeof p.eta_minutes === 'number' ? p.eta_minutes * 60 : null,
  );

  const availability: Availability =
    p.available === false || p.is_available === false
      ? 'UNAVAILABLE'
      : p.available === true || p.is_available === true
        ? 'AVAILABLE'
        : 'UNKNOWN';

  const expiresAt =
    typeof p.expires_at === 'string'
      ? p.expires_at
      : new Date(ctx.now + ctx.fallbackTtlSeconds * 1000).toISOString();

  const providerTimestamp = typeof p.quoted_at === 'string' ? p.quoted_at : null;

  const normalizedCategory = categorizeProduct({ provider, productId, productName });

  const quote: NormalizedQuote = {
    id: quoteKey({ source: 'obi', provider, providerProductId: productId }),
    provider,
    providerProductId: productId,
    providerProductName: productName,
    normalizedCategory,

    priceType: price.priceType,
    priceMinMinor: price.minMinor,
    priceMaxMinor: price.maxMinor,
    displayPriceMinor: price.minMinor,
    rankingPriceMinor:
      price.priceType === 'ESTIMATE_RANGE'
        ? midpointMinor(price.minMinor, price.maxMinor)
        : price.minMinor,
    currency,

    pickupEtaSeconds,
    // Obi's trip duration is the provider's own figure when present; we never
    // synthesise one from a map service and present it as the provider's.
    tripDurationSeconds: firstNumber(p.trip_duration_seconds, p.duration_seconds),
    distanceMeters: firstNumber(p.distance_meters),

    availability,
    source: 'obi',
    sourceMethod: 'AGGREGATOR_API',
    // Obi's market feed is a public/anonymous price unless a linked-account
    // product is contracted; we do not assume personalisation we cannot prove.
    accountContext: 'PUBLIC',

    receivedAt: ctx.receivedAt,
    providerTimestamp,
    expiresAt,
    freshness: computeFreshness(ctx.receivedAt, expiresAt, ctx.now),
    scheduledFor: null,

    bookingHandoff: resolveBookingHandoff({
      provider,
      pickup: ctx.pickup,
      destination: ctx.destination,
      providerProductId: productId,
      // A URL inside a provider payload is untrusted input: the resolver
      // validates it against the allowlist and discards it if it fails.
      sourceSuppliedUrl: typeof p.booking_url === 'string' ? p.booking_url : (p.deep_link ?? null),
    }),
    confidenceClass: confidenceFor(price.priceType, price.minMinor, price.maxMinor),
    metadata: {
      obiProvider: providerRaw,
      surgeMultiplier: typeof p.surge_multiplier === 'number' ? p.surge_multiplier : null,
    },
  };

  return quote;
}

function pickCurrency(p: ObiProduct): string | null {
  const raw = p.price?.currency ?? p.price?.currency_code ?? p.currency ?? null;
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase();
  return isIso4217(code) ? code : null;
}

interface ExtractedPrice {
  priceType: PriceType;
  minMinor: number;
  maxMinor: number;
}

/**
 * Decide the price TYPE from what the payload actually contains:
 *  - explicit upfront flag or type string -> UPFRONT_QUOTE
 *  - distinct low/high                    -> ESTIMATE_RANGE
 *  - single amount                        -> ESTIMATE
 * We never upgrade an estimate to an upfront quote.
 */
function extractPrice(p: ObiProduct, currency: string): ExtractedPrice | null {
  const price = p.price ?? {};
  const lowRaw = price.low ?? price.min ?? p.price_low ?? null;
  const highRaw = price.high ?? price.max ?? p.price_high ?? null;
  const pointRaw = price.amount ?? p.price_amount ?? null;

  const declaredType = (price.type ?? '').toString().toUpperCase();
  const declaredUpfront = price.is_upfront === true || declaredType.includes('UPFRONT');
  const declaredMetered = declaredType.includes('METER');

  try {
    if (lowRaw !== null && lowRaw !== undefined && highRaw !== null && highRaw !== undefined) {
      const minMinor = majorToMinor(lowRaw, currency);
      const maxMinor = majorToMinor(highRaw, currency);
      if (minMinor === maxMinor) {
        return {
          priceType: declaredUpfront
            ? 'UPFRONT_QUOTE'
            : declaredMetered
              ? 'METERED_ESTIMATE'
              : 'ESTIMATE',
          minMinor,
          maxMinor,
        };
      }
      return {
        priceType: 'ESTIMATE_RANGE',
        minMinor: Math.min(minMinor, maxMinor),
        maxMinor: Math.max(minMinor, maxMinor),
      };
    }

    if (pointRaw !== null && pointRaw !== undefined) {
      const minor = majorToMinor(pointRaw, currency);
      const priceType: PriceType = declaredUpfront
        ? 'UPFRONT_QUOTE'
        : declaredMetered
          ? 'METERED_ESTIMATE'
          : 'ESTIMATE';
      return { priceType, minMinor: minor, maxMinor: minor };
    }
  } catch {
    return null;
  }
  return null;
}

function firstNumber(...values: Array<number | null | undefined>): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  }
  return null;
}
