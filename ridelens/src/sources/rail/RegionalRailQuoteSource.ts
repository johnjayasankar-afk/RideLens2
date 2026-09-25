/**
 * Regional rail, from the operator's published fare table.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE HOLE THIS FILLS                                                      │
 * │                                                                          │
 * │ A regulated taxi fare follows the city the trip *starts* in. That rule   │
 * │ is right — a New York medallion cab may not pick up in Westchester — and │
 * │ it meant a suburban pickup produced an entirely empty comparison, on a   │
 * │ screen that had already drawn the route and named the distance.          │
 * │                                                                          │
 * │ The commuter railroad has no such gap. Its fare is published, fixed by   │
 * │ the authority, identical for every rider, and for a trip into town it is │
 * │ usually both the cheapest option and one of the fastest.                 │
 * │                                                                          │
 * │ HONESTY RULES                                                            │
 * │ • This prices the rail leg, and says so. The distance from each endpoint │
 * │   to its station rides along with the quote and is shown on the card.    │
 * │ • The fare is exact, so it is an UPFRONT_QUOTE — unless the rider's      │
 * │   boarding window straddles a peak boundary, when it becomes the band    │
 * │   between the two published fares and nothing in between.                │
 * │ • Category is TRANSIT. It is not a car and never competes as one.        │
 * │ • Party size multiplies: every rider buys a ticket.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { getConfig } from '@/config/env';
import { fareBands, sampleFareDay, type FareBand } from '@/domain/fareclock';
import { localTimeIn } from '@/domain/geo';
import { computeFreshness } from '@/domain/freshness';
import { quoteKey } from '@/domain/ids';
import { formatMoney, midpointMinor } from '@/domain/money';
import type { NormalizedQuote } from '@/domain/quote';
import { measureWalk, type Walk } from '@/location/walking';
import {
  planRailTrip,
  priceRailTrip,
  railFareBoundaries,
  type RailFare,
  type RailFareBasis,
  type RailSystem,
  type RailTrip,
} from '@/domain/rail';
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
import { RAIL_SYSTEMS, systemsNear } from './systems';

/**
 * How long a fare stays quotable.
 *
 * The number itself does not change for months, but *peak* changes on a clock,
 * and a fare cached across 4pm on a weekday would be understated by several
 * dollars. Two minutes keeps the quote on the right side of any boundary.
 */
const FARE_TTL_SECONDS = 120;

export class RegionalRailQuoteSource implements QuoteSource {
  capabilities(): SourceCapabilities {
    return {
      sourceId: 'regional_rail',
      sourceMethod: 'PUBLISHED_TARIFF',
      displayName: 'Regional rail (published fare tables)',
      providers: ['transit'],
      supportsPrice: true,
      // The fare is fixed by rule, which is the strongest kind of upfront.
      supportsUpfront: true,
      // Scheduled run time comes from the operator's own timetable.
      supportsETA: false,
      supportsBooking: false,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ['US'],
      cacheTtlSeconds: FARE_TTL_SECONDS,
      rateLimit: null,
    };
  }

  enablement(): SourceEnablement {
    if (getConfig().ENABLE_REGIONAL_RAIL !== 'true') {
      return {
        enabled: false,
        blockerCode: 'MISSING_CREDENTIAL',
        blockerMessage: 'Regional-rail fares are switched off for this deployment.',
        requiredEnv: ['ENABLE_REGIONAL_RAIL'],
      };
    }
    return { enabled: true, blockerCode: null, blockerMessage: null, requiredEnv: [] };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const gate = this.enablement();
    if (!gate.enabled) {
      throw new SourceError(gate.blockerMessage ?? 'Disabled.', 'regional_rail', 'DISABLED');
    }

    const started = Date.now();
    const at = new Date(started);
    /*
     * Peak and off-peak are a published rule, so a seat next Tuesday at 6:20am
     * prices exactly as certainly as one on the next train. The whole day view
     * is anchored here too, so the chart runs forward from the departure the
     * rider actually asked about rather than from now.
     */
    const departAt = request.departAt ?? at;
    const quotes: NormalizedQuote[] = [];
    const warnings: string[] = [];

    const nearby = systemsNear(request.pickup, request.destination);
    if (nearby.length === 0) {
      return {
        sourceId: 'regional_rail',
        quotes,
        providersAttempted: ['transit'],
        fetchedAt: at.toISOString(),
        latencyMs: Date.now() - started,
        warnings: [
          `No regional railroad in RideLens serves this area. Covered today: ${RAIL_SYSTEMS.map((s) => s.name).join(', ')}.`,
        ],
      };
    }

    for (const system of nearby) {
      const planned = planRailTrip({
        pickup: request.pickup,
        destination: request.destination,
        system,
      });
      if ('reason' in planned) {
        warnings.push(`${system.name}: ${planned.reason}`);
        continue;
      }

      /*
       * Both ends, on a pedestrian graph, at the same time.
       *
       * The far end is the one that was missing. A fare that puts the rider on
       * a platform 3.4 km from the airport they asked for has not finished the
       * trip, and until this was measured the product had no way to know that
       * — it published the boarding distance, called the train run "the trip",
       * and let the reader assume the rest.
       *
       * In parallel because they are independent and a rider is waiting; both
       * fall back to a straight-line estimate on their own, so a slow or absent
       * router costs accuracy rather than the fare.
       */
      const [boardWalk, alightWalk] = await Promise.all([
        measureWalk(request.pickup, {
          lat: planned.origin.station.lat,
          lng: planned.origin.station.lng,
        }),
        measureWalk(
          { lat: planned.destination.station.lat, lng: planned.destination.station.lng },
          request.destination,
        ),
      ]);

      const fare = priceRailTrip({
        system,
        trip: planned,
        at: departAt,
        passengers: request.partySize,
      });

      /*
       * The whole day's fare, on the same terms as a taxi rate card. Peak and
       * off-peak are a published rule on a clock, so every hour is knowable
       * with no forecasting — and on Metro-North the gap is real money: zone 4
       * is $10.25 off-peak against $13.75 peak. Null where the operator
       * charges one fare all day, which is Metra, so nothing is drawn that
       * would imply a variation the rider does not have.
       */
      const dayBands = fareBands(
        sampleFareDay({
          timeZone: system.timeZone,
          from: departAt,
          boundaries: railFareBoundaries(system, planned),
          priceAt: (when) =>
            priceRailTrip({
              system,
              trip: planned,
              at: when,
              passengers: request.partySize,
              // A chosen departure time has an exact fare; only "leaving now"
              // has to straddle the boundary.
              horizonSeconds: 0,
            }),
        }),
      );

      const receivedAt = at.toISOString();
      // A projection does not expire on a two-minute clock; the rule behind it
      // will say the same thing in an hour.
      const expiresAt = request.departAt
        ? null
        : new Date(started + FARE_TTL_SECONDS * 1000).toISOString();
      const basis = planned.fare;

      quotes.push({
        id: quoteKey({
          source: 'regional_rail',
          provider: 'transit',
          providerProductId: `${system.id}:${planned.origin.station.id}:${planned.destination.station.id}`,
        }),
        provider: 'transit',
        providerProductId:
          basis.kind === 'TO_TERMINAL'
            ? `${system.id}-zone-${basis.zoneId}`
            : `${system.id}-zones-${[...basis.zones].sort().join('-')}`,
        providerProductName: `${system.name} · ${lineOf(basis)} line`,
        normalizedCategory: 'TRANSIT',

        priceType: fare.exact ? 'UPFRONT_QUOTE' : 'ESTIMATE_RANGE',
        priceMinMinor: fare.minMinor,
        priceMaxMinor: fare.maxMinor,
        displayPriceMinor: fare.minMinor,
        rankingPriceMinor: fare.exact ? fare.minMinor : midpointMinor(fare.minMinor, fare.maxMinor),
        currency: fare.currency,

        // There is no vehicle coming to fetch anyone; the rider goes to the
        // platform. Claiming a pickup ETA here would be a fiction.
        pickupEtaSeconds: null,
        tripDurationSeconds: planned.runSeconds,
        distanceMeters: null,

        availability: 'UNKNOWN',
        source: 'regional_rail',
        sourceMethod: 'PUBLISHED_TARIFF',
        accountContext: 'PUBLIC',

        receivedAt,
        providerTimestamp: null,
        expiresAt,
        freshness: computeFreshness(receivedAt, expiresAt, started),
        scheduledFor: request.departAt ? request.departAt.toISOString() : null,

        bookingHandoff: resolveBookingHandoff({
          provider: 'transit',
          pickup: request.pickup,
          destination: request.destination,
          providerProductId: system.id,
          sourceSuppliedUrl: null,
        }),
        // The fare is certain; what it does not include is the part either side
        // of the platform, and that is what keeps this out of HIGH.
        confidenceClass: 'MEDIUM',
        metadata: buildMetadata(
          system,
          planned,
          fare,
          request.partySize,
          started,
          dayBands,
          boardWalk,
          alightWalk,
        ),
      });
    }

    return {
      sourceId: 'regional_rail',
      quotes,
      providersAttempted: ['transit'],
      fetchedAt: at.toISOString(),
      latencyMs: Date.now() - started,
      warnings,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const gate = this.enablement();
    const checkedAt = new Date().toISOString();
    if (!gate.enabled) {
      return {
        sourceId: 'regional_rail',
        status: 'NOT_CONFIGURED',
        detail: gate.blockerMessage ?? 'Disabled.',
        checkedAt,
        latencyMs: null,
        blockerCode: gate.blockerCode,
      };
    }
    const stations = RAIL_SYSTEMS.reduce((n, s) => n + s.stations.length, 0);
    const oldest = [...RAIL_SYSTEMS.map((s) => s.verifiedOn)].sort()[0] ?? 'never';
    return {
      sourceId: 'regional_rail',
      status: 'HEALTHY',
      detail: `${stations} stations across ${RAIL_SYSTEMS.length} railroads; fare tables last verified ${oldest}.`,
      checkedAt,
      latencyMs: 0,
      blockerCode: null,
    };
  }
}

function lineOf(basis: RailFareBasis): string {
  return basis.kind === 'TO_TERMINAL' ? basis.zone.line : basis.lineName;
}

function miles(meters: number): string {
  return (meters / 1609.344).toFixed(1);
}

function ageInDays(iso: string, now: number): number {
  const then = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(then)) return 0;
  return Math.trunc((now - then) / 86_400_000);
}

/**
 * The card copy.
 *
 * Two things have to survive into it whatever the operator's table looks like:
 * which station the rider actually boards at, and how far each end of the trip
 * is from its platform. A rail fare that hid those would read as a door-to-door
 * price and undercut every car on the screen by pretending the walk is free.
 */
function buildMetadata(
  system: RailSystem,
  trip: RailTrip,
  fare: RailFare,
  passengers: number,
  now: number,
  dayBands: FareBand[] | null,
  boardWalk: Walk,
  alightWalk: Walk,
): NormalizedQuote['metadata'] {
  const basis = trip.fare;
  const money = (minor: number) => formatMoney(minor, system.currency);
  const riders = passengers > 1 ? ` × ${passengers} riders` : '';

  // Rendered by the detail sheet as "label: amount" rows, split on the last
  // colon, so neither half may contain ": ".
  const rows: string[] = [];
  let fareBasisText: string;
  let timing: string;

  if (basis.kind === 'TO_TERMINAL') {
    fareBasisText = `zone ${basis.zoneId} on the ${basis.zone.line} line, to and from ${terminalLabelOf(system)}`;
    if (fare.exact) {
      const word = fare.peak === true ? 'peak' : 'off-peak';
      const each = fare.peak === true ? basis.zone.peakMinor : basis.zone.offPeakMinor;
      rows.push(
        `Zone ${basis.zoneId} one-way, ${word} — ${money(each)} each: ${money(fare.minMinor)}`,
      );
      timing = `Right now that is the ${word} fare.`;
    } else {
      rows.push(`Zone ${basis.zoneId} one-way, off-peak: ${money(fare.minMinor)}`);
      rows.push(`Zone ${basis.zoneId} one-way, peak: ${money(fare.maxMinor)}`);
      timing =
        'Trains around now fall either side of a peak boundary, so this is the band between the two published fares — never a number in between.';
    }
  } else {
    const [a, b] = basis.zones;
    fareBasisText =
      a === b
        ? `a trip within zone ${a} on the ${basis.lineName} line`
        : `a zone ${a} to zone ${b} trip on the ${basis.lineName} line`;
    rows.push(`Zones ${a}–${b} one-way — ${money(basis.fareMinor)} each: ${money(fare.minMinor)}`);
    timing = 'This operator charges one fare all day, so there is no peak price to miss.';
  }

  if (passengers > 1) rows.push(`Riders — every one buys a ticket: ${passengers}`);

  const board = trip.origin;
  const alight = trip.destination;
  const access =
    `You board at ${board.station.name}, ${miles(board.meters)} mi from the pickup, and get off at ` +
    `${alight.station.name}, ${miles(alight.meters)} mi from the destination. Both of those are on ` +
    'you — this is the price of the train, not of the whole door-to-door trip.';

  const onboard =
    fare.onboardMinor === null
      ? ''
      : ` Bought from the conductor instead of before boarding it would be ${money(fare.onboardMinor)}.`;

  return {
    system: system.name,
    operator: system.operator,
    authority: system.authority,
    line: lineOf(basis),
    fareZone: basis.kind === 'TO_TERMINAL' ? basis.zoneId : basis.zones.join('-'),
    direction: basis.kind === 'TO_TERMINAL' ? basis.direction : 'EITHER',
    boardStation: board.station.name,
    boardStationId: board.station.id,
    // The walked figure, not the straight line: a footpath is what the rider
    // covers, and on the leg that prompted this it is a quarter longer.
    boardAccessMeters: Math.trunc(boardWalk.meters),
    boardAccessSeconds: Math.trunc(boardWalk.seconds),
    boardAccessBasis: boardWalk.basis,
    alightStation: alight.station.name,
    alightStationId: alight.station.id,
    alightAccessMeters: Math.trunc(alightWalk.meters),
    alightAccessSeconds: Math.trunc(alightWalk.seconds),
    alightAccessBasis: alightWalk.basis,
    onboardFareMinor: fare.onboardMinor,
    passengers,
    breakdown: rows.join(' · '),
    // JSON in a metadata string, the same shape the rate card uses: the bag is
    // flat by design and this keeps the day view reading one format.
    ...(dayBands
      ? {
          fareDayBands: JSON.stringify(dayBands),
          // Where "now" sits on that strip, in the railroad's clock rather than
          // the reader's.
          fareClockNowLabel: localClock(system.timeZone, new Date(now)),
        }
      : {}),
    // The detail sheet already renders these for the taxi rate cards; a
    // published fare table is the same kind of document, so it reuses them
    // rather than growing a parallel set of near-identical keys.
    rateCardUrl: system.fareSourceUrl,
    rateCardLabel: 'Published fare table',
    rateCardVerifiedOn: system.verifiedOn,
    rateCardAgeDays: ageInDays(system.verifiedOn, now),
    explanation:
      `${system.name} charges this for ${fareBasisText}. The fare is published by ${system.authority} ` +
      `and is the same for every rider${riders}; zones are not distances, so every station in the zone ` +
      `pays it. ${timing} ${access}${onboard} Fare table verified ${system.verifiedOn}.`,
  };
}

function localClock(timeZone: string, at: Date): string {
  const t = localTimeIn(timeZone, at);
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

function terminalLabelOf(system: RailSystem): string {
  return system.fares.kind === 'TO_TERMINAL' ? system.fares.terminalLabel : system.name;
}
