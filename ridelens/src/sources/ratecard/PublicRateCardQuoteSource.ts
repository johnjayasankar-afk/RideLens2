/**
 * Regulated taxi fares, computed from published municipal rate cards.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONE SOURCE THAT NEEDS NO CREDENTIAL                                  │
 * │                                                                          │
 * │ Every other provider in RideLens prices by market forces behind an       │
 * │ access-controlled API. A licensed taxi does not: its fare is fixed by a  │
 * │ public authority and published as a rate card. Given that card and a     │
 * │ measured route, the fare is computable — which is precisely what the     │
 * │ meter in the cab is doing.                                              │
 * │                                                                          │
 * │ So this source produces genuinely live prices, with no key, no contract  │
 * │ and no access control touched:                                          │
 * │   • the route is measured live, per request                              │
 * │   • surcharges are evaluated against the market's current local time     │
 * │   • airport flat fares are EXACT, because the regulator fixed them       │
 * │                                                                          │
 * │ WHAT IT IS NOT                                                           │
 * │ It is not Uber, Lyft or Empower pricing, and it must never be dressed    │
 * │ up as such. Those fares are market-set and unavailable without           │
 * │ authorization. This is the taxi sitting next to them at the kerb.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { getConfig } from '@/config/env';
import { computeFare, type FareResult } from '@/domain/tariff';
import { fareBands, fareByHour, fareOutlook } from '@/domain/fareclock';
import { computeFreshness } from '@/domain/freshness';
import { quoteKey } from '@/domain/ids';
import { midpointMinor } from '@/domain/money';
import type { NormalizedQuote, PriceType } from '@/domain/quote';
import { confidenceFor } from '@/domain/uncertainty';
import { resolveBookingHandoff } from '@/booking/resolver';
import { fetchRouteMeasurement } from '@/location/routing';
import type {
  QuoteRequest,
  QuoteSource,
  SourceCapabilities,
  SourceEnablement,
  SourceHealth,
  SourceQuoteResult,
} from '../types';
import { SourceError } from '../types';
import { COVERED_MARKETS, tariffForPickup } from './tariffs';

/**
 * A regulated fare is only as fresh as the rate card and the clock. Surcharge
 * windows turn over on the hour, so a two-minute TTL keeps a quote from
 * straddling 4pm and understating a rush-hour fare.
 */
const CACHE_TTL_SECONDS = 120;

export class PublicRateCardQuoteSource implements QuoteSource {
  capabilities(): SourceCapabilities {
    return {
      sourceId: 'public_rate_card',
      sourceMethod: 'PUBLISHED_TARIFF',
      displayName: 'Published taxi rate cards',
      providers: ['taxi'],
      supportsPrice: true,
      // Airport flat fares are exact and binding.
      supportsUpfront: true,
      // A rate card says nothing about where the cabs are right now.
      supportsETA: false,
      supportsBooking: false,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ['US'],
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      rateLimit: null,
    };
  }

  enablement(): SourceEnablement {
    const cfg = getConfig();
    if (cfg.ENABLE_PUBLIC_RATE_CARD !== 'true') {
      return {
        enabled: false,
        blockerCode: 'MISSING_CREDENTIAL',
        blockerMessage: 'Published taxi rate cards are switched off for this deployment.',
        requiredEnv: ['ENABLE_PUBLIC_RATE_CARD'],
      };
    }
    // No credential exists to be missing. This is the point of the source.
    return { enabled: true, blockerCode: null, blockerMessage: null, requiredEnv: [] };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const gate = this.enablement();
    if (!gate.enabled) {
      throw new SourceError(gate.blockerMessage ?? 'Disabled.', 'public_rate_card', 'DISABLED');
    }

    const started = Date.now();
    const warnings: string[] = [];

    const tariff = tariffForPickup(request.pickup);
    if (!tariff) {
      /*
       * Honest silence — but silence that says something.
       *
       * A regulated fare belongs to the place the trip STARTS: the meter is
       * the meter of whoever licensed the cab at the kerb. So a pickup in
       * Scarsdale or Newark has no New York fare even though the destination
       * is Manhattan, and a licensed yellow cab may not pick up there at all.
       *
       * Saying only "not covered" makes that look like a gap in the app. It is
       * not — it is a gap in what any published tariff can answer — and naming
       * the covered destination is the difference between a dead end and an
       * explanation.
       */
      const destinationMarket = tariffForPickup(request.destination);
      const warning = destinationMarket
        ? `A regulated fare follows the city the trip starts in, and this one starts outside ${destinationMarket.marketName}. ` +
          `A licensed ${destinationMarket.marketName} cab cannot pick up here, so no published fare applies — though the same trip in the other direction is priced. ` +
          `Covered today: ${COVERED_MARKETS.join(', ')}.`
        : `No published taxi rate card for this pickup. Covered today: ${COVERED_MARKETS.join(', ')}.`;
      return {
        sourceId: 'public_rate_card',
        quotes: [],
        providersAttempted: ['taxi'],
        fetchedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        warnings: [warning],
      };
    }

    // With geometry: the fare needs to know whether the route goes through a
    // tolled tunnel or bridge, which origin and destination alone cannot say.
    const measurement = await fetchRouteMeasurement(
      request.pickup,
      request.destination,
      request.signal,
      true,
    );
    if (!measurement) {
      throw new SourceError(
        'Could not measure the route, so the meter cannot be computed.',
        'public_rate_card',
        'UPSTREAM',
      );
    }

    const measured = {
      distanceMeters: measurement.distanceMeters,
      durationSeconds: measurement.durationSeconds,
      coordinates: measurement.coordinates,
    };
    /*
     * A published tariff prices any instant, so a trip next Tuesday at 6:20am
     * is arithmetic rather than a forecast — the same arithmetic, on the same
     * rate card, that prices a trip leaving now. `at` is the only thing that
     * changes, and everything downstream reads it from here so the fare, the
     * outlook and the day chart can never end up describing different moments.
     */
    const at = request.departAt;
    const ctx = {
      pickup: request.pickup,
      destination: request.destination,
      passengers: request.partySize,
      ...(at ? { at } : {}),
    };
    const fare = computeFare(tariff, measured, ctx);

    // The same route priced at every upcoming tariff boundary. Legitimate only
    // because the tariff is a published rule: this is arithmetic on a rate
    // card, not a forecast of what anyone will charge.
    const outlook = fareOutlook(tariff, measured, ctx);
    // A rise is time-critical; a saving hours away is not. Show the urgent one.
    const change = outlook?.rises ?? outlook?.cheaper ?? null;

    // The whole day, reduced to the handful of distinct prices the tariff
    // actually produces. Null when the fare never moves, so the UI draws
    // nothing rather than a flat line implying a variation that is not there.
    const dayBands = fareBands(fareByHour(tariff, measured, ctx));

    const now = Date.now();
    const receivedAt = new Date(now).toISOString();
    /*
     * A fare priced for now goes stale on a clock, because the surcharge
     * windows it sits between are minutes away. A fare priced for next Tuesday
     * does not: the rule that produces it will say the same thing in an hour.
     * Giving a projection a two-minute expiry made the card grey out and offer
     * a Refresh that could only ever return the identical number.
     */
    const expiresAt = at ? null : new Date(now + CACHE_TTL_SECONDS * 1000).toISOString();

    if (fare.kind === 'NEGOTIATED') {
      // The regulator publishes no number for this trip. Reporting the reason
      // is the whole answer; inventing a figure would not be.
      return {
        sourceId: 'public_rate_card',
        quotes: [],
        providersAttempted: ['taxi'],
        fetchedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        warnings: fare.explanation,
      };
    }

    // A flat fare is a rule, not a prediction. A metered fare is a band.
    const priceType: PriceType = fare.kind === 'FLAT' ? 'UPFRONT_QUOTE' : 'METERED_ESTIMATE';
    const productName =
      fare.kind === 'FLAT'
        ? (fare.components[0]?.label ?? 'Taxi flat fare')
        : `${tariff.marketName} metered taxi`;

    const quote: NormalizedQuote = {
      id: quoteKey({
        source: 'public_rate_card',
        provider: 'taxi',
        providerProductId: `${tariff.marketId}:${fare.kind.toLowerCase()}`,
      }),
      provider: 'taxi',
      providerProductId: `${tariff.marketId}-${fare.kind.toLowerCase()}`,
      providerProductName: productName,
      normalizedCategory: 'TAXI',

      priceType,
      priceMinMinor: fare.minMinor,
      priceMaxMinor: fare.maxMinor,
      displayPriceMinor: fare.minMinor,
      rankingPriceMinor:
        fare.minMinor === fare.maxMinor
          ? fare.minMinor
          : midpointMinor(fare.minMinor, fare.maxMinor),
      currency: fare.currency,

      // A rate card knows the price, not where the cabs are.
      pickupEtaSeconds: null,
      // The routed duration is a MAP estimate, never a provider's own figure —
      // so it is not published as tripDurationSeconds.
      tripDurationSeconds: null,
      distanceMeters: fare.distanceMeters,

      availability: 'UNKNOWN',
      source: 'public_rate_card',
      sourceMethod: 'PUBLISHED_TARIFF',
      accountContext: 'PUBLIC',

      receivedAt,
      providerTimestamp: null,
      expiresAt,
      freshness: computeFreshness(receivedAt, expiresAt, now),
      scheduledFor: at ? at.toISOString() : null,

      bookingHandoff: resolveBookingHandoff({
        provider: 'taxi',
        pickup: request.pickup,
        destination: request.destination,
        providerProductId: null,
        sourceSuppliedUrl: null,
      }),
      confidenceClass:
        fare.kind === 'FLAT' ? 'HIGH' : confidenceFor(priceType, fare.minMinor, fare.maxMinor),
      metadata: {
        market: tariff.marketName,
        authority: tariff.authority,
        rateCardUrl: tariff.sourceUrl,
        rateCardVerifiedOn: tariff.verifiedOn,
        // How long ago someone actually read this card against the regulator.
        // Cities change tariffs by rulemaking and tell nobody downstream, so a
        // card's age is part of how much the number is worth — Chicago's rose
        // 24% in a single revision. The UI warns past the staleness threshold
        // rather than presenting an old figure with the same confidence as a
        // fresh one.
        rateCardAgeDays: rateCardAgeDays(tariff.verifiedOn),
        fareKind: fare.kind,
        routedDurationSeconds: fare.durationSeconds,
        routeProvenance: 'MAP_ESTIMATE',
        breakdown: fare.components
          .map((c) => `${c.label}: $${(c.amountMinor / 100).toFixed(2)}${c.uncertain ? '*' : ''}`)
          .join(' · '),
        explanation: fare.explanation.join(' '),
        // JSON in a metadata string: the bag is flat by design, and this keeps
        // the shape in one place rather than smeared across a dozen keys.
        ...(dayBands
          ? {
              fareDayBands: JSON.stringify(dayBands),
              // Where "now" sits on that strip, in the market's clock rather
              // than the reader's — a rider in London looking at a New York
              // fare should see the marker at New York's hour.
              fareClockNowLabel: `${String(fare.localTime.hour).padStart(2, '0')}:${String(fare.localTime.minute).padStart(2, '0')}`,
            }
          : {}),
        ...(change
          ? {
              fareClockKind: change.deltaMinor > 0 ? 'RISES' : 'CHEAPER',
              fareClockAtLabel: change.atLabel,
              fareClockInMinutes: change.inMinutes,
              fareClockDeltaMinor: change.deltaMinor,
              fareClockNote:
                change.deltaMinor > 0
                  ? `This fare rises $${(change.deltaMinor / 100).toFixed(2)} at ${change.atLabel} local time, when the ${tariff.marketName} tariff changes.`
                  : `The same trip is $${(Math.abs(change.deltaMinor) / 100).toFixed(2)} less from ${change.atLabel} local time, when the ${tariff.marketName} tariff changes.`,
            }
          : {}),
      },
    };

    if (fare.kind === 'METERED') {
      warnings.push(
        `${tariff.marketName} taxi fare computed from the published tariff; the meter also charges for time in slow traffic.`,
      );
    }

    return {
      sourceId: 'public_rate_card',
      quotes: [quote],
      providersAttempted: ['taxi'],
      fetchedAt: receivedAt,
      latencyMs: Date.now() - started,
      warnings,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const gate = this.enablement();
    const checkedAt = new Date().toISOString();
    if (!gate.enabled) {
      return {
        sourceId: 'public_rate_card',
        status: 'NOT_CONFIGURED',
        detail: gate.blockerMessage ?? 'Disabled.',
        checkedAt,
        latencyMs: null,
        blockerCode: gate.blockerCode,
      };
    }

    // The rate cards are local data; what can fail is the routing service.
    const started = Date.now();
    const probe = await fetchRouteMeasurement(
      { lat: 40.7233, lng: -73.9959 },
      { lat: 40.644, lng: -73.7823 },
    );
    return {
      sourceId: 'public_rate_card',
      status: probe ? 'HEALTHY' : 'DEGRADED',
      detail: probe
        ? `Rate cards loaded for ${COVERED_MARKETS.join(', ')}; routing reachable.`
        : 'Rate cards loaded, but the routing service did not answer, so metered fares cannot be computed.',
      checkedAt,
      latencyMs: Date.now() - started,
      blockerCode: null,
    };
  }
}

export type { FareResult };

/** Whole days since a rate card was last checked against its regulator. */
function rateCardAgeDays(verifiedOn: string): number {
  const then = Date.parse(`${verifiedOn}T00:00:00Z`);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}
