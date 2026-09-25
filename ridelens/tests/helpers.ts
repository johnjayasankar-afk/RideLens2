/** Shared test scaffolding. */
import { resetConfigCache } from '@/config/env';
import { resetGeocoder } from '@/location/geocoder';
import { quoteCache } from '@/orchestration/cache';
import { resetOrchestrationState } from '@/orchestration/engine';
import { resetRateLimiter } from '@/orchestration/ratelimit';
import { resetRepository } from '@/db/repository';
import { resetShareStore } from '@/db/shareStore';
import { metrics } from '@/observability/metrics';
import { resetRegistry } from '@/sources/registry';
import type { NormalizedQuote, PriceType, ProviderId, SourceId } from '@/domain/quote';
import type { CanonicalLocation } from '@/location/types';

/** Apply env, then clear every module-level cache that reads it. */
export function withEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigCache();
  resetRegistry();
  resetGeocoder();
  resetRateLimiter();
  resetRepository();
  resetShareStore();
  quoteCache.clear();
  // Circuit-breaker and in-flight state must not leak between tests, or one
  // test's induced failures silently skip another test's sources.
  resetOrchestrationState();
  metrics.reset();
}

/**
 * Reset to a known-empty configuration.
 *
 * The two credential-free sources — the published rate card and the bike-share
 * feeds — are switched OFF here even though both are ON by default in the
 * product. Neither needs a credential, so they would otherwise turn up in every
 * test trying to isolate one specific source. Tests that care about them enable
 * them explicitly, and config.test.ts covers the real defaults.
 */
export function clearRideLensEnv(): void {
  const keys = Object.keys(process.env).filter((k) =>
    /^(OBI|UBER|LYFT|EMPOWER|CURB|RIDELENS|GEOCODER|LOCATION_PROVIDER|UPSTASH|SUPABASE|NEXT_PUBLIC_SUPABASE|QUOTE_|RATE_LIMIT|TOKEN_ENCRYPTION|OSM_|ENABLE_|ROUTING_)/.test(
      k,
    ),
  );
  withEnv({
    ...Object.fromEntries(keys.map((k) => [k, undefined])),
    ENABLE_PUBLIC_RATE_CARD: 'false',
    ENABLE_BIKE_SHARE: 'false',
    ENABLE_REGIONAL_RAIL: 'false',
  });
}

export const PICKUP: CanonicalLocation = {
  lat: 40.7233,
  lng: -73.9959,
  formattedAddress: '14 Prince St, New York, NY 10012, USA',
  placeId: 'test/prince',
  name: '14 Prince St',
  city: 'New York',
  region: 'NY',
  country: 'US',
  geocoder: 'fixture',
};

export const DESTINATION: CanonicalLocation = {
  lat: 40.644,
  lng: -73.7823,
  formattedAddress: 'JFK Airport Terminal 4, Jamaica, NY 11430, USA',
  placeId: 'test/jfk',
  name: 'JFK Terminal 4',
  city: 'New York',
  region: 'NY',
  country: 'US',
  geocoder: 'fixture',
};

export interface QuoteOverrides {
  id?: string;
  provider?: ProviderId;
  productId?: string;
  productName?: string;
  category?: NormalizedQuote['normalizedCategory'];
  priceType?: PriceType;
  minMinor?: number;
  maxMinor?: number;
  rankingMinor?: number;
  currency?: string;
  eta?: number | null;
  source?: SourceId;
  sourceMethod?: NormalizedQuote['sourceMethod'];
  accountContext?: NormalizedQuote['accountContext'];
  availability?: NormalizedQuote['availability'];
  confidence?: NormalizedQuote['confidenceClass'];
  receivedAt?: string;
  expiresAt?: string | null;
  freshness?: NormalizedQuote['freshness'];
}

/** Build a quote with sensible defaults so tests state only what they mean. */
export function makeQuote(o: QuoteOverrides = {}): NormalizedQuote {
  const min = o.minMinor ?? 2500;
  const max = o.maxMinor ?? min;
  const priceType = o.priceType ?? (min === max ? 'ESTIMATE' : 'ESTIMATE_RANGE');
  const provider = o.provider ?? 'uber';
  const productId = o.productId ?? 'uberx';
  const source = o.source ?? 'obi';
  return {
    id: o.id ?? `${source}:${provider}:${productId}`,
    provider,
    providerProductId: productId,
    providerProductName: o.productName ?? 'UberX',
    normalizedCategory: o.category ?? 'STANDARD',
    priceType,
    priceMinMinor: min,
    priceMaxMinor: max,
    displayPriceMinor: min,
    rankingPriceMinor: o.rankingMinor ?? Math.floor((min + max) / 2),
    currency: o.currency ?? 'USD',
    pickupEtaSeconds: o.eta === undefined ? 180 : o.eta,
    tripDurationSeconds: 1800,
    distanceMeters: 26000,
    availability: o.availability ?? 'AVAILABLE',
    source,
    sourceMethod: o.sourceMethod ?? 'AGGREGATOR_API',
    accountContext: o.accountContext ?? 'PUBLIC',
    receivedAt: o.receivedAt ?? new Date().toISOString(),
    providerTimestamp: null,
    expiresAt: o.expiresAt === undefined ? null : o.expiresAt,
    freshness: o.freshness ?? 'LIVE',
    scheduledFor: null,
    bookingHandoff: null,
    confidenceClass: o.confidence ?? (priceType === 'UPFRONT_QUOTE' ? 'HIGH' : 'MEDIUM'),
    metadata: {},
  };
}
