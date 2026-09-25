/**
 * Shared bikes, priced from open real-time feeds.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE MOST GENUINELY LIVE SOURCE IN RIDELENS                               │
 * │                                                                          │
 * │ GBFS is an open standard that exists so trip planners can read a bike    │
 * │ system's live state; cities frequently require operators to publish it   │
 * │ as a permit condition. There is no key, no contract and no access        │
 * │ control, because the data is published to be read.                       │
 * │                                                                          │
 * │ Unlike a rate card, this changes minute to minute: the feeds declare a   │
 * │ 60-second TTL and station counts move constantly. A quote here names a   │
 * │ specific station with a specific number of bikes in it right now.        │
 * │                                                                          │
 * │ HONESTY RULES                                                            │
 * │ • No quote unless a real station has a bike AND another has a free dock  │
 * │   within a short walk. "This city has bikes" is not a price.             │
 * │ • The fare band comes from ride duration, which genuinely varies. The    │
 * │   unlock fee and per-minute rate are published figures.                  │
 * │ • Category is BIKE, never a vehicle class. It is a different mode and is │
 * │   kept out of the car comparison.                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { getConfig } from '@/config/env';
import {
  availableOf,
  planBikeTrip,
  priceBikeTrip,
  VEHICLE_ARTICLE,
  VEHICLE_LABEL,
} from '@/domain/bike';
import type { BikeVehicle } from '@/domain/bike';
import { computeFreshness } from '@/domain/freshness';
import { quoteKey } from '@/domain/ids';
import { isIso4217, midpointMinor } from '@/domain/money';
import type { NormalizedQuote } from '@/domain/quote';
import { fetchRouteMeasurement } from '@/location/routing';
import { resolveBookingHandoff } from '@/booking/resolver';
import type {
  QuoteRequest,
  QuoteSource,
  SourceCapabilities,
  SourceEnablement,
  SourceHealth,
  SourceQuoteResult,
} from '../types';
import { SourceError } from '../types';
import { fetchSystemSnapshot, type PricingPlan } from './gbfs';
import { BIKE_MARKETS, BIKE_SYSTEMS, systemsFor } from './systems';

export class BikeShareQuoteSource implements QuoteSource {
  capabilities(): SourceCapabilities {
    return {
      sourceId: 'bikeshare_gbfs',
      sourceMethod: 'OPEN_REALTIME_FEED',
      displayName: 'Bike share (GBFS live feeds)',
      providers: ['bikeshare'],
      supportsPrice: true,
      // The rate is published, but the total depends on ride time.
      supportsUpfront: false,
      // Walking time to a real station with a real bike in it.
      supportsETA: true,
      supportsBooking: false,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ['US'],
      // The feeds themselves declare 60 seconds; never cache past that.
      cacheTtlSeconds: 60,
      rateLimit: null,
    };
  }

  enablement(): SourceEnablement {
    if (getConfig().ENABLE_BIKE_SHARE !== 'true') {
      return {
        enabled: false,
        blockerCode: 'MISSING_CREDENTIAL',
        blockerMessage: 'Bike-share feeds are switched off for this deployment.',
        requiredEnv: ['ENABLE_BIKE_SHARE'],
      };
    }
    return { enabled: true, blockerCode: null, blockerMessage: null, requiredEnv: [] };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const gate = this.enablement();
    if (!gate.enabled) {
      throw new SourceError(gate.blockerMessage ?? 'Disabled.', 'bikeshare_gbfs', 'DISABLED');
    }

    const started = Date.now();

    /*
     * A bike quote is only honest because it names a station with a bike in it
     * right now. Nobody knows which docks will have bikes next Tuesday, and a
     * price for one is a price for a ride that may not be available. The whole
     * point of this source is that it refuses to exist without the live count,
     * so it refuses here too rather than quietly quoting the fare alone.
     */
    if (request.departAt) {
      return {
        sourceId: 'bikeshare_gbfs',
        quotes: [],
        providersAttempted: ['bikeshare'],
        fetchedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        warnings: [
          'Shared bikes are priced from live station counts, so they cannot be quoted for a future departure. Ask again nearer the time.',
        ],
      };
    }

    const candidates = systemsFor(request.pickup).filter((s) =>
      // Both ends must be in the same system's service area.
      systemsFor(request.destination).some((d) => d.id === s.id),
    );

    if (candidates.length === 0) {
      return {
        sourceId: 'bikeshare_gbfs',
        quotes: [],
        providersAttempted: ['bikeshare'],
        fetchedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        warnings: [
          `No bike-share system covers both ends of this trip. Covered today: ${BIKE_MARKETS.join(', ')}.`,
        ],
      };
    }

    // Routed distance, not straight line: a crow-flies figure understates the
    // ride and therefore the fare.
    const measurement = await fetchRouteMeasurement(
      request.pickup,
      request.destination,
      request.signal,
    );

    const warnings: string[] = [];
    const quotes: NormalizedQuote[] = [];

    for (const system of candidates) {
      const snapshot = await fetchSystemSnapshot(system, request.signal);
      if (!snapshot) {
        warnings.push(`${system.name} feed did not respond.`);
        continue;
      }

      const plan = choosePlan(snapshot.plans);
      if (!plan) {
        warnings.push(
          `${system.name} publishes no single-ride price — only passes or subscriptions — so no fare is shown for it.`,
        );
        continue;
      }

      const planned = planBikeTrip({
        pickup: request.pickup,
        destination: request.destination,
        // Fall back to straight line only if routing failed; noted below.
        rideMeters: measurement?.distanceMeters ?? straightLine(request),
        stations: snapshot.stations,
        vehicle: planVehicle(plan),
      });

      if ('reason' in planned) {
        warnings.push(`${system.name}: ${planned.reason}`);
        continue;
      }

      const { trip } = planned;
      const currency = isIso4217(plan.currency) ? plan.currency : 'USD';
      const fare = priceBikeTrip(trip, { ...plan, currency });

      const now = Date.now();
      const receivedAt = new Date(now).toISOString();
      const expiresAt = new Date(now + snapshot.ttlSeconds * 1000).toISOString();
      // Availability has to mean "one of the thing we priced is in the rack",
      // not "the rack is not empty".
      const available = availableOf(trip.start.station, trip.vehicle);

      quotes.push({
        id: quoteKey({
          source: 'bikeshare_gbfs',
          provider: 'bikeshare',
          providerProductId: system.id,
        }),
        provider: 'bikeshare',
        providerProductId: system.id,
        providerProductName: system.name,
        normalizedCategory: 'BIKE',

        priceType: fare.minMinor === fare.maxMinor ? 'ESTIMATE' : 'ESTIMATE_RANGE',
        priceMinMinor: fare.minMinor,
        priceMaxMinor: fare.maxMinor,
        displayPriceMinor: fare.minMinor,
        rankingPriceMinor:
          fare.minMinor === fare.maxMinor
            ? fare.minMinor
            : midpointMinor(fare.minMinor, fare.maxMinor),
        currency,

        // Time to walk to a specific station that has a bike in it right now.
        pickupEtaSeconds: trip.start.walkSeconds,
        // Door to door, including both walks.
        tripDurationSeconds: Math.round((trip.totalSecondsLow + trip.totalSecondsHigh) / 2),
        distanceMeters: trip.rideMeters,

        availability: available > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
        source: 'bikeshare_gbfs',
        sourceMethod: 'OPEN_REALTIME_FEED',
        accountContext: 'PUBLIC',

        receivedAt,
        providerTimestamp: snapshot.lastUpdated,
        expiresAt,
        freshness: computeFreshness(receivedAt, expiresAt, now),
        scheduledFor: null,

        bookingHandoff: resolveBookingHandoff({
          provider: 'bikeshare',
          pickup: request.pickup,
          destination: request.destination,
          providerProductId: system.id,
          sourceSuppliedUrl: null,
        }),
        confidenceClass: 'MEDIUM',
        metadata: {
          system: system.name,
          operator: system.operator,
          planName: fare.planName,
          breakdown: fare.breakdown,
          startStation: trip.start.station.name,
          startStationId: trip.start.station.id,
          vehicle: VEHICLE_LABEL[trip.vehicle],
          startVehiclesAvailable: available,
          startBikesTotal: trip.start.station.bikesAvailable,
          startEbikes: availableOf(trip.start.station, 'EBIKE'),
          startWalkMeters: Math.round(trip.start.walkMeters),
          // Published so the journey strip can draw the walk rather than infer
          // it. Both walks are already inside tripDurationSeconds, and naming
          // them is what lets a reader see that a "34 min" bike trip is eleven
          // minutes of walking with a ride in the middle.
          startWalkSeconds: Math.round(trip.start.walkSeconds),
          endStation: trip.end.station.name,
          endStationId: trip.end.station.id,
          endDocks: trip.end.station.docksAvailable,
          endWalkMeters: Math.round(trip.end.walkMeters),
          endWalkSeconds: Math.round(trip.end.walkSeconds),
          rideMinutesLow: Math.ceil(trip.rideSecondsLow / 60),
          rideMinutesHigh: Math.ceil(trip.rideSecondsHigh / 60),
          feedTtlSeconds: snapshot.ttlSeconds,
          routeProvenance: measurement ? 'ROUTED' : 'STRAIGHT_LINE',
          explanation: `${fare.planName} on ${system.name}, operated by ${system.operator}. This is the price for ${VEHICLE_ARTICLE[trip.vehicle]} ${VEHICLE_LABEL[trip.vehicle]}, and ${available} ${available === 1 ? 'is' : 'are'} at ${trip.start.station.name} right now. Station counts come from the operator's live GBFS feed and refresh about every ${snapshot.ttlSeconds} seconds. The price band reflects how long the ride takes, not doubt about the published rate.`,
        },
      });

      if (!measurement) {
        warnings.push(
          `${system.name} distance is a straight line — routing was unavailable, so the ride may be longer.`,
        );
      }
    }

    return {
      sourceId: 'bikeshare_gbfs',
      quotes,
      providersAttempted: ['bikeshare'],
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      warnings,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const gate = this.enablement();
    const checkedAt = new Date().toISOString();
    if (!gate.enabled) {
      return {
        sourceId: 'bikeshare_gbfs',
        status: 'NOT_CONFIGURED',
        detail: gate.blockerMessage ?? 'Disabled.',
        checkedAt,
        latencyMs: null,
        blockerCode: gate.blockerCode,
      };
    }
    const started = Date.now();
    const probeSystem = BIKE_SYSTEMS[0];
    if (!probeSystem) {
      return {
        sourceId: 'bikeshare_gbfs',
        status: 'NOT_CONFIGURED',
        detail: 'No bike-share systems are registered.',
        checkedAt,
        latencyMs: null,
        blockerCode: null,
      };
    }
    const probe = await fetchSystemSnapshot(probeSystem);
    return {
      sourceId: 'bikeshare_gbfs',
      status: probe ? 'HEALTHY' : 'DEGRADED',
      detail: probe
        ? `${probe.stations.length} live stations from ${probe.system.name}; feed TTL ${probe.ttlSeconds}s.`
        : 'GBFS feed did not respond, so no bike quote can be produced.',
      checkedAt,
      latencyMs: Date.now() - started,
      blockerCode: null,
    };
  }
}

/**
 * Which vehicle a published plan prices.
 *
 * GBFS has no field for this, so the plan's own id and name are all there is to
 * go on — and it is worth reading them, because a plan that says "EBIKE" and a
 * station that holds only classic bikes cannot both describe the same trip.
 */
function planVehicle(plan: PricingPlan): BikeVehicle {
  const text = `${plan.planId} ${plan.name}`;
  if (/ebike|e-bike|electric/i.test(text)) return 'EBIKE';
  if (/classic|standard|pedal/i.test(text)) return 'CLASSIC';
  return 'ANY';
}

/** Vehicles that are not a bike. Divvy publishes a scooter plan in the same feed. */
const NOT_A_BIKE = /scooter|moped|car|van/i;

/**
 * A plan that prices one trip, rather than a pass that buys many.
 *
 * GBFS `system_pricing_plans` is not a fare table — it is whatever products the
 * operator sells. Philadelphia's Indego publishes only monthly passes there:
 * "Indego30" at $21.60, "IndegoFlex" at $10.00, "Access Pass" at $5.40, none
 * with a per-minute rate. Picking the cheapest of those and printing it as a
 * trip price would put a *monthly subscription* on screen labelled as a bike
 * ride, which is precisely the kind of confident wrong number this product
 * exists not to produce.
 *
 * So a plan qualifies only if it looks like one ride: a per-minute component
 * (structured or stated in the description), or a name that says single ride.
 * Everything else takes the system out of the comparison with a warning.
 */
function isSingleRidePlan(p: PricingPlan): boolean {
  if (p.perMinuteMinor !== null && p.perMinuteMinor > 0) return true;
  return /single[\s_-]?ride|per[\s_-]?trip|pay[\s_-]?as[\s_-]?you[\s_-]?go/i.test(
    `${p.planId} ${p.name}`,
  );
}

/**
 * Prefer a classic single-ride plan over an e-bike one: it is the cheapest
 * genuinely available option, and quoting the dearer plan by default would
 * overstate the price.
 *
 * When an operator publishes only an e-bike plan — Citi Bike does — that is the
 * plan we use, and `planVehicle` then holds the quote to an actual e-bike being
 * present. The alternative, pricing an e-bike ride off a rack of classic bikes,
 * is a number that looks live and is not true.
 *
 * Ties break on the per-minute rate, not on array order. Divvy publishes a bike
 * plan and a scooter plan at the same $1.00 unlock but $0.20 and $0.44 a
 * minute; which one came first in the feed was all that stood between the
 * cheaper and a fare more than twice as high. Scooters are filtered out
 * outright — this is a bike quote — but the tie-break is what stops the next
 * such pair being decided by luck.
 */
function choosePlan(plans: PricingPlan[]): PricingPlan | null {
  const rides = plans.filter(
    (p) => isSingleRidePlan(p) && !NOT_A_BIKE.test(`${p.planId} ${p.name}`),
  );
  if (rides.length === 0) return null;
  const classic = rides.filter((p) => !/ebike|e-bike|electric/i.test(`${p.planId} ${p.name}`));
  const pool = classic.length > 0 ? classic : rides;
  return (
    [...pool].sort(
      (a, b) => a.unlockMinor - b.unlockMinor || (a.perMinuteMinor ?? 0) - (b.perMinuteMinor ?? 0),
    )[0] ?? null
  );
}

function straightLine(request: QuoteRequest): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(request.destination.lat - request.pickup.lat);
  const dLng = toRad(request.destination.lng - request.pickup.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(request.pickup.lat)) *
      Math.cos(toRad(request.destination.lat)) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
