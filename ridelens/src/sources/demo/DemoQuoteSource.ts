/**
 * Deterministic fixture source — TESTS AND LOCAL DEMO ONLY.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS SOURCE CAN NEVER RUN IN PRODUCTION.                                 │
 * │ config.demoSourceActive is `RIDELENS_DEMO_SOURCE === 'enabled' &&        │
 * │ !isProduction`, so a production build ignores the flag entirely and      │
 * │ startupChecks reports DEMO_SOURCE_IN_PRODUCTION as an error.             │
 * │ enablement() re-checks the same condition here as a second gate.         │
 * │                                                                          │
 * │ Its quotes carry source='demo_fixture' end to end, the reconciler ranks  │
 * │ that source below every real one, and the UI labels the session as       │
 * │ fixture-backed. Nothing about it can be mistaken for live data.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Prices vary deterministically with the route so E2E assertions are stable
 * while still exercising range handling, unavailability and mixed semantics.
 */
import { getConfig } from '@/config/env';
import { computeFreshness } from '@/domain/freshness';
import { quoteKey } from '@/domain/ids';
import { midpointMinor } from '@/domain/money';
import type { NormalizedQuote, PriceType, ProviderId } from '@/domain/quote';
import { categorizeProduct } from '@/domain/taxonomy';
import { confidenceFor } from '@/domain/uncertainty';
import { resolveBookingHandoff } from '@/booking/resolver';
import { haversineMeters } from '@/location/types';
import type {
  QuoteRequest,
  QuoteSource,
  SourceCapabilities,
  SourceEnablement,
  SourceHealth,
  SourceQuoteResult,
} from '../types';
import { SourceError } from '../types';

interface FixtureProduct {
  provider: ProviderId;
  productId: string;
  productName: string;
  /** Minor units per kilometre, plus a flat base. */
  baseMinor: number;
  perKmMinor: number;
  priceType: PriceType;
  /** For ranges, the half-width as a fraction of the point price. */
  spread?: number;
  etaSeconds: number;
  available?: boolean;
}

const FIXTURES: FixtureProduct[] = [
  {
    provider: 'empower',
    productId: 'everyday',
    productName: 'Everyday',
    baseMinor: 480,
    perKmMinor: 118,
    priceType: 'ESTIMATE',
    etaSeconds: 240,
  },
  {
    provider: 'empower',
    productId: 'everyday-xl',
    productName: 'Everyday XL',
    baseMinor: 690,
    perKmMinor: 168,
    priceType: 'ESTIMATE',
    etaSeconds: 420,
  },
  {
    provider: 'curb',
    productId: 'taxi-standard',
    productName: 'Curb Taxi',
    baseMinor: 550,
    perKmMinor: 133,
    priceType: 'UPFRONT_QUOTE',
    etaSeconds: 180,
  },
  {
    provider: 'curb',
    productId: 'taxi-wav',
    productName: 'Curb Accessible',
    baseMinor: 550,
    perKmMinor: 133,
    priceType: 'UPFRONT_QUOTE',
    etaSeconds: 600,
  },
  {
    provider: 'lyft',
    productId: 'lyft',
    productName: 'Lyft',
    baseMinor: 640,
    perKmMinor: 148,
    priceType: 'ESTIMATE_RANGE',
    spread: 0.07,
    etaSeconds: 300,
  },
  {
    provider: 'lyft',
    productId: 'lyft_xl',
    productName: 'Lyft XL',
    baseMinor: 890,
    perKmMinor: 205,
    priceType: 'ESTIMATE_RANGE',
    spread: 0.07,
    etaSeconds: 480,
  },
  {
    provider: 'uber',
    productId: 'uberx',
    productName: 'UberX',
    baseMinor: 700,
    perKmMinor: 163,
    priceType: 'ESTIMATE_RANGE',
    spread: 0.11,
    etaSeconds: 120,
  },
  {
    provider: 'uber',
    productId: 'uberxl',
    productName: 'UberXL',
    baseMinor: 980,
    perKmMinor: 228,
    priceType: 'ESTIMATE_RANGE',
    spread: 0.11,
    etaSeconds: 360,
  },
  {
    provider: 'uber',
    productId: 'uber-black',
    productName: 'Uber Black',
    baseMinor: 1850,
    perKmMinor: 392,
    priceType: 'ESTIMATE_RANGE',
    spread: 0.09,
    etaSeconds: 540,
  },
  {
    provider: 'uber',
    productId: 'uber-green',
    productName: 'Uber Green',
    baseMinor: 690,
    perKmMinor: 160,
    priceType: 'ESTIMATE_RANGE',
    spread: 0.11,
    etaSeconds: 900,
    available: false,
  },
];

export class DemoQuoteSource implements QuoteSource {
  capabilities(): SourceCapabilities {
    return {
      sourceId: 'demo_fixture',
      sourceMethod: 'LOCAL_FIXTURE',
      displayName: 'Local fixture (non-production)',
      providers: ['uber', 'lyft', 'empower', 'curb'],
      supportsPrice: true,
      supportsUpfront: true,
      supportsETA: true,
      supportsBooking: true,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ['*'],
      cacheTtlSeconds: 0,
      rateLimit: null,
    };
  }

  enablement(): SourceEnablement {
    const cfg = getConfig();
    if (!cfg.demoSourceActive) {
      return {
        enabled: false,
        blockerCode: 'NON_PRODUCTION_ONLY',
        blockerMessage:
          'The fixture source is available only outside production, with RIDELENS_DEMO_SOURCE=enabled.',
        requiredEnv: ['RIDELENS_DEMO_SOURCE'],
      };
    }
    return { enabled: true, blockerCode: null, blockerMessage: null, requiredEnv: [] };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const gate = this.enablement();
    if (!gate.enabled) {
      throw new SourceError(gate.blockerMessage ?? 'Disabled.', 'demo_fixture', 'DISABLED');
    }

    const started = Date.now();
    const meters = haversineMeters(request.pickup, request.destination);
    const km = meters / 1000;

    const now = Date.now();
    const receivedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + 90_000).toISOString();
    const currency = 'USD';

    const quotes: NormalizedQuote[] = FIXTURES.map((f) => {
      const point = f.baseMinor + Math.round(f.perKmMinor * km);
      const spread = f.spread ?? 0;
      const minMinor = spread > 0 ? Math.round(point * (1 - spread)) : point;
      const maxMinor = spread > 0 ? Math.round(point * (1 + spread)) : point;

      return {
        id: quoteKey({
          source: 'demo_fixture',
          provider: f.provider,
          providerProductId: f.productId,
        }),
        provider: f.provider,
        providerProductId: f.productId,
        providerProductName: f.productName,
        normalizedCategory: categorizeProduct({
          provider: f.provider,
          productId: f.productId,
          productName: f.productName,
        }),
        priceType: f.priceType,
        priceMinMinor: minMinor,
        priceMaxMinor: maxMinor,
        displayPriceMinor: minMinor,
        rankingPriceMinor:
          f.priceType === 'ESTIMATE_RANGE' ? midpointMinor(minMinor, maxMinor) : minMinor,
        currency,
        pickupEtaSeconds: f.etaSeconds,
        tripDurationSeconds: Math.round(km * 150),
        distanceMeters: meters,
        availability: f.available === false ? 'UNAVAILABLE' : 'AVAILABLE',
        source: 'demo_fixture',
        sourceMethod: 'LOCAL_FIXTURE',
        accountContext: 'PUBLIC',
        receivedAt,
        providerTimestamp: receivedAt,
        expiresAt,
        freshness: computeFreshness(receivedAt, expiresAt, now),
        scheduledFor: null,
        bookingHandoff: resolveBookingHandoff({
          provider: f.provider,
          pickup: request.pickup,
          destination: request.destination,
          providerProductId: f.productId,
          sourceSuppliedUrl: null,
        }),
        confidenceClass: confidenceFor(f.priceType, minMinor, maxMinor),
        metadata: { fixture: true },
      } satisfies NormalizedQuote;
    });

    return {
      sourceId: 'demo_fixture',
      quotes,
      providersAttempted: ['uber', 'lyft', 'empower', 'curb'],
      fetchedAt: receivedAt,
      latencyMs: Date.now() - started,
      warnings: ['Fixture data — not a live market price.'],
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const gate = this.enablement();
    return {
      sourceId: 'demo_fixture',
      status: gate.enabled ? 'HEALTHY' : 'NOT_CONFIGURED',
      detail: gate.enabled
        ? 'Fixture source active (non-production).'
        : (gate.blockerMessage ?? ''),
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      blockerCode: gate.blockerCode,
    };
  }
}
