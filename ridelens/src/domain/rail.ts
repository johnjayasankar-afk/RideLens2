/**
 * Regional rail, priced from the operator's published fare table.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS EXISTS                                                          │
 * │                                                                          │
 * │ A regulated taxi fare follows the city the trip starts in. That is a     │
 * │ correct rule and it leaves a real hole: a trip that starts in a suburb   │
 * │ has no city meter behind it, so RideLens had nothing to say about the    │
 * │ single most ordinary journey there is — getting from the suburbs into    │
 * │ town. Not "no cheap option": no option at all, on a screen that had      │
 * │ already drawn the route.                                                 │
 * │                                                                          │
 * │ For that trip the commuter railroad is usually the cheapest thing on the │
 * │ map and often the fastest, and its price is not a market price at all —  │
 * │ it is a published fare table, exactly like a taxi rate card.             │
 * │                                                                          │
 * │ TWO SHAPES OF TABLE, BECAUSE OPERATORS PUBLISH TWO                       │
 * │ • TO_TERMINAL — Metro-North publishes fares "to and from Grand Central". │
 * │   The outer station's zone sets the price, and peak costs more.          │
 * │ • ZONE_PAIR — Metra publishes a fare for the pair of zones a trip spans, │
 * │   any station to any station, with no peak distinction at all.           │
 * │ Modelling one as the other would invent fares the operator never wrote.  │
 * │                                                                          │
 * │ WHAT IS EXACT AND WHAT IS NOT                                            │
 * │ • The fare is exact. Metro-North zone 4 off-peak is $10.25 by rule.      │
 * │   → UPFRONT_QUOTE                                                        │
 * │ • Whether the rider's actual train is a peak train is not knowable from  │
 * │   a clock alone. When the boarding horizon straddles a peak boundary the │
 * │   quote becomes the band between the two published fares — and never a   │
 * │   number in between.  → ESTIMATE_RANGE                                   │
 * │                                                                          │
 * │ WHAT IT DOES NOT CLAIM                                                   │
 * │ This is the price of the rail leg. It is not a door-to-door price: the   │
 * │ rider still has to reach the station and travel on at the far end. Both  │
 * │ distances travel with the quote and are stated on the card. A shared     │
 * │ bike carries the same caveat, and for the same reason.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Every fare is an integer minor unit transcribed from the operator's own
 * table. Nothing here is derived from a per-mile formula.
 */
import {
  distanceMeters,
  inWindow,
  isUsPublicHoliday,
  isWeekday,
  localTimeIn,
  type LocalTime,
  type Point,
} from './geo';

export interface RailStation {
  /** The operator's own stop id, from its published schedule feed. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  zone: number;
  /**
   * Lines calling here, from the operator's timetable. Used to refuse a pair
   * of stations no single train connects.
   */
  routes: readonly string[];
  /**
   * Distinct scheduled times in the published timetable — the operator's own
   * count of how often anything stops here, deduplicated across the weekday
   * and weekend variants of the same departure.
   *
   * A fare is only an option if a train comes. Breakneck Ridge is a weekend
   * flag stop for hikers with two entries in the whole timetable; Metra's
   * O'Hare Transfer is served by a peak-only line a handful of times a day.
   * Quoting either at two in the afternoon would be a real price for a
   * journey the rider cannot make.
   */
  timetableCalls: number;
  /**
   * Median scheduled run time to the city terminal across every direct train
   * in the published timetable. Null where the operator runs no direct
   * service — Metro-North's Waterbury branch changes at Bridgeport — and the
   * quote then declines to state a duration rather than inventing a connection.
   */
  medianRunSeconds: number | null;
}

/** Peak is a property of the train, so each window names the end it applies to. */
export interface PeakWindow {
  startMin: number;
  endMin: number;
}

/** One zone of a table written against the city terminals. */
export interface TerminalZone {
  /** One-way adult fare to or from the terminal, in minor units. */
  peakMinor: number;
  offPeakMinor: number;
  /** Bought from the conductor instead of before boarding. Always dearer. */
  onboardPeakMinor: number;
  onboardOffPeakMinor: number;
  /** For the explanation, e.g. "Harlem / Hudson". */
  line: string;
}

/** Metro-North's shape: fares published to and from the city terminals. */
export interface TerminalZoneFares {
  kind: 'TO_TERMINAL';
  terminalIds: readonly string[];
  terminalLabel: string;
  cityLabel: string;
  /** Windows in which a train *arriving* at the terminal is a peak train. */
  peakArrivalWindows: readonly PeakWindow[];
  /** Windows in which a train *departing* the terminal is a peak train. */
  peakDepartureWindows: readonly PeakWindow[];
  zones: Readonly<Record<number, TerminalZone>>;
}

/** Metra's shape: a fare for the unordered pair of zones a trip spans. */
export interface ZonePairFares {
  kind: 'ZONE_PAIR';
  pairs: ReadonlyArray<{ between: readonly [number, number]; fareMinor: number }>;
  /** Named on the card, e.g. "Union Pacific North". */
  lineNames: Readonly<Record<string, string>>;
}

export type RailFares = TerminalZoneFares | ZonePairFares;

export interface RailSystem {
  id: string;
  name: string;
  operator: string;
  authority: string;
  fareSourceUrl: string;
  scheduleSourceUrl: string;
  verifiedOn: string;
  timeZone: string;
  currency: string;
  fares: RailFares;
  stations: readonly RailStation[];
}

/**
 * How far the rider may be from a station and still be on this trip.
 *
 * Two different numbers because they describe two different acts. Nobody walks
 * to a suburban station — they are dropped off or they park, and three miles is
 * an ordinary morning. The city end is a walk or a subway ride, so it is held
 * tighter: 6.5km reaches the whole of Manhattan below Harlem, where the second
 * terminal takes over.
 */
export const STATION_ACCESS_METERS = 8_000;
export const TERMINAL_ACCESS_METERS = 6_500;

/**
 * The shortest trip worth putting a train on.
 *
 * Two downtown terminals can be half a mile apart, and matching a short local
 * hop to a pair of them would quote a fare for a train that does not run
 * between them. Below this, walking or any of the other modes is the answer.
 */
export const MIN_RAIL_METERS = 3_000;

/**
 * Below this many entries in the timetable, a station is not a service anybody
 * can turn up and use. Chosen from the feeds themselves: it clears the
 * peak-only branches and the seasonal flag stops, and touches nothing that
 * runs to a normal commuter frequency.
 */
export const MIN_TIMETABLE_CALLS = 20;

/**
 * How far ahead to look when deciding whether the rider's train is a peak one.
 *
 * Long enough to cover reaching the station and waiting for a train, short
 * enough that it describes this trip rather than the whole afternoon.
 */
export const BOARDING_HORIZON_SECONDS = 45 * 60;

export type RailDirection = 'INBOUND' | 'OUTBOUND';

export interface RailAccess {
  station: RailStation;
  /** Straight-line metres from the rider's endpoint to the station. */
  meters: number;
}

/** How this particular trip's fare is looked up, and in which table. */
export type RailFareBasis =
  | {
      kind: 'TO_TERMINAL';
      zoneId: number;
      zone: TerminalZone;
      direction: RailDirection;
      /** The station away from the terminal, whose zone sets the price. */
      station: RailStation;
    }
  | {
      kind: 'ZONE_PAIR';
      zones: readonly [number, number];
      fareMinor: number;
      lineName: string;
    };

export interface RailTrip {
  origin: RailAccess;
  destination: RailAccess;
  runSeconds: number | null;
  fare: RailFareBasis;
}

export interface RailPlanRefusal {
  reason: string;
}

function nearest(
  system: RailSystem,
  at: Point,
  filter: (s: RailStation) => boolean,
): RailAccess | null {
  let best: RailAccess | null = null;
  for (const station of system.stations) {
    if (!filter(station)) continue;
    const meters = distanceMeters(at, { lat: station.lat, lng: station.lng });
    if (best === null || meters < best.meters) best = { station, meters };
  }
  return best;
}

function miles(meters: number): string {
  return (meters / 1609.344).toFixed(1);
}

/**
 * Match both endpoints to stations, or say precisely why the railroad does not
 * serve this trip.
 */
export function planRailTrip(args: {
  pickup: Point;
  destination: Point;
  system: RailSystem;
}): RailTrip | RailPlanRefusal {
  const { system, pickup, destination } = args;

  /*
   * The trip itself has to be long enough to be a railroad journey, judged on
   * the rider's own two points rather than on the stations. Chicago has six
   * downtown terminals; a walk across the Loop is within reach of several of
   * them, and a pair three miles apart on one line is easy to find. Without
   * this the app would quote a train ticket for a ten-minute walk.
   */
  const direct = distanceMeters(pickup, destination);
  if (direct < MIN_RAIL_METERS) {
    return { reason: `This trip is ${miles(direct)} mi — too short for a railroad journey.` };
  }

  const planned =
    system.fares.kind === 'TO_TERMINAL'
      ? planToTerminal(pickup, destination, system, system.fares)
      : planZonePair(pickup, destination, system, system.fares);
  if ('reason' in planned) return planned;

  /*
   * And the walking must not dwarf the journey. Getting to a station three
   * miles away to ride four is not a trip anybody takes; saying so is better
   * than a technically correct fare for it.
   */
  const access = planned.origin.meters + planned.destination.meters;
  if (access > direct) {
    return {
      reason: `The nearest ${system.name} stations are ${miles(access)} mi away between them, further than the ${miles(direct)} mi trip itself.`,
    };
  }
  return planned;
}

/**
 * A table written against the city terminals gives fares to and from them and
 * nothing else, so a quote requires exactly one end at a terminal. A White
 * Plains to Stamford fare exists, but not in any document this app has read,
 * and a plausible number invented from two terminal fares would be wrong in
 * both directions.
 */
function planToTerminal(
  pickup: Point,
  destination: Point,
  system: RailSystem,
  fares: TerminalZoneFares,
): RailTrip | RailPlanRefusal {
  const isTerminal = (s: RailStation) => fares.terminalIds.includes(s.id);

  const terminalNear = (p: Point) => {
    const found = nearest(system, p, isTerminal);
    return found !== null && found.meters <= TERMINAL_ACCESS_METERS ? found : null;
  };
  const served = (s: RailStation) => s.timetableCalls >= MIN_TIMETABLE_CALLS;
  const stationNear = (p: Point) => {
    const found = nearest(system, p, (s) => !isTerminal(s) && served(s));
    return found !== null && found.meters <= STATION_ACCESS_METERS ? found : null;
  };

  const pickupTerminal = terminalNear(pickup);
  const destTerminal = terminalNear(destination);

  if (pickupTerminal !== null && destTerminal !== null) {
    return {
      reason: `Both ends of this trip are in ${fares.cityLabel}, which ${system.name} does not price as a railroad journey.`,
    };
  }

  if (pickupTerminal === null && destTerminal === null) {
    const closest = nearest(system, pickup, () => true);
    const detail =
      closest === null
        ? ''
        : ` The nearest station to the pickup is ${closest.station.name}, ${miles(closest.meters)} mi away.`;
    return {
      reason: `${system.name} publishes fares to and from ${fares.terminalLabel}, and neither end of this trip is there.${detail}`,
    };
  }

  const direction: RailDirection = pickupTerminal === null ? 'INBOUND' : 'OUTBOUND';
  const outerPoint = direction === 'INBOUND' ? pickup : destination;
  const outer = stationNear(outerPoint);

  if (outer === null) {
    const end = direction === 'INBOUND' ? 'pickup' : 'destination';
    const anyNear = nearest(system, outerPoint, (s) => !isTerminal(s));
    if (anyNear !== null && anyNear.meters <= STATION_ACCESS_METERS && !served(anyNear.station)) {
      return { reason: sparseReason(system, anyNear.station, end) };
    }
    const detail =
      anyNear === null
        ? ''
        : ` ${anyNear.station.name} is the closest, ${miles(anyNear.meters)} mi away.`;
    return { reason: `No ${system.name} station is within reach of the ${end}.${detail}` };
  }

  const zone = fares.zones[outer.station.zone];
  if (zone === undefined) {
    return { reason: `${outer.station.name} is not in the published fare table.` };
  }

  const terminal = direction === 'INBOUND' ? destTerminal : pickupTerminal;
  /* istanbul ignore next -- one of the two is non-null by construction above. */
  if (terminal === null) return { reason: 'No terminal matched this trip.' };

  return {
    origin: direction === 'INBOUND' ? outer : terminal,
    destination: direction === 'INBOUND' ? terminal : outer,
    runSeconds: outer.station.medianRunSeconds,
    fare: {
      kind: 'TO_TERMINAL',
      zoneId: outer.station.zone,
      zone,
      direction,
      station: outer.station,
    },
  };
}

/**
 * A zone-pair table prices any station to any station, so both ends simply have
 * to be near a station — but only stations a single train actually connects.
 *
 * Which station is right at each end depends on the other end, which is why
 * this searches for the best connected *pair* rather than taking the nearest
 * station twice. Chicago has six downtown terminals within a mile of each
 * other, and the one nearest a Loop address is on the Metra Electric while the
 * train from Evanston arrives at Ogilvie. Nearest-twice answers "no single line
 * connects these", which is true of the pair it picked and false of the trip.
 */
function planZonePair(
  pickup: Point,
  destination: Point,
  system: RailSystem,
  fares: ZonePairFares,
): RailTrip | RailPlanRefusal {
  const allFrom = withinReach(system, pickup);
  const allTo = withinReach(system, destination);
  const from = allFrom.filter((a) => a.station.timetableCalls >= MIN_TIMETABLE_CALLS);
  const to = allTo.filter((a) => a.station.timetableCalls >= MIN_TIMETABLE_CALLS);

  for (const [end, point, reachable, everything] of [
    ['pickup', pickup, from, allFrom],
    ['destination', destination, to, allTo],
  ] as const) {
    if (reachable.length > 0) continue;
    const stranded = everything[0];
    if (stranded !== undefined) return { reason: sparseReason(system, stranded.station, end) };
    const closest = nearest(system, point, () => true);
    const detail =
      closest === null
        ? ''
        : ` ${closest.station.name} is the closest, ${miles(closest.meters)} mi away.`;
    return { reason: `No ${system.name} station is within reach of the ${end}.${detail}` };
  }

  let best: { origin: RailAccess; destination: RailAccess; line: string } | null = null;
  let sameLineExists = false;
  for (const a of from) {
    for (const b of to) {
      if (a.station.id === b.station.id) continue;
      const line = a.station.routes.find((r) => b.station.routes.includes(r));
      if (line === undefined) continue;
      sameLineExists = true;
      const apart = distanceMeters(
        { lat: a.station.lat, lng: a.station.lng },
        { lat: b.station.lat, lng: b.station.lng },
      );
      if (apart < MIN_RAIL_METERS) continue;
      // Least walking at both ends together; the rider does both.
      if (best === null || a.meters + b.meters < best.origin.meters + best.destination.meters) {
        best = { origin: a, destination: b, line };
      }
    }
  }

  if (best === null) {
    const a = from[0];
    const b = to[0];
    /* istanbul ignore next -- both lists are non-empty by the guard above. */
    if (a === undefined || b === undefined) return { reason: 'No station matched this trip.' };
    if (sameLineExists) {
      const apart = distanceMeters(
        { lat: a.station.lat, lng: a.station.lng },
        { lat: b.station.lat, lng: b.station.lng },
      );
      return {
        reason: `${a.station.name} and ${b.station.name} are ${miles(apart)} mi apart — too close for a railroad journey.`,
      };
    }
    return {
      reason: `No single ${system.name} line connects ${a.station.name} and ${b.station.name}, so no published fare covers the trip in one ride.`,
    };
  }

  const originZone = best.origin.station.zone;
  const destZone = best.destination.station.zone;
  const pair = fares.pairs.find(
    (p) =>
      (p.between[0] === originZone && p.between[1] === destZone) ||
      (p.between[0] === destZone && p.between[1] === originZone),
  );
  if (pair === undefined) {
    return {
      reason: `${system.name} publishes no fare between zone ${originZone} and zone ${destZone}.`,
    };
  }

  // Only station-to-terminal run times are baked in, so a suburb-to-suburb trip
  // states no duration rather than a borrowed one.
  const runSeconds =
    originZone === 1
      ? best.destination.station.medianRunSeconds
      : destZone === 1
        ? best.origin.station.medianRunSeconds
        : null;

  return {
    origin: best.origin,
    destination: best.destination,
    runSeconds,
    fare: {
      kind: 'ZONE_PAIR',
      zones: [originZone, destZone],
      fareMinor: pair.fareMinor,
      lineName: fares.lineNames[best.line] ?? best.line,
    },
  };
}

/** Every station a rider could plausibly start or finish at, nearest first. */
function withinReach(system: RailSystem, at: Point): RailAccess[] {
  return system.stations
    .map((station) => ({
      station,
      meters: distanceMeters(at, { lat: station.lat, lng: station.lng }),
    }))
    .filter((a) => a.meters <= STATION_ACCESS_METERS)
    .sort((a, b) => a.meters - b.meters);
}

function sparseReason(system: RailSystem, station: RailStation, end: string): string {
  return (
    `The only ${system.name} station near the ${end} is ${station.name}, which the timetable ` +
    'serves a handful of times a day. A fare for a train that is not running is not an option.'
  );
}

/**
 * Whether the train the rider would be on is a peak train.
 *
 * The operator defines peak by the schedule, not by when a ticket is bought:
 * inbound it is the arrival time at the terminal, outbound the departure from
 * it. Holidays are off-peak all day, as are weekends.
 */
export function isPeakTrain(args: {
  fares: TerminalZoneFares;
  timeZone: string;
  direction: RailDirection;
  /** When the rider boards at the origin station. */
  boardAt: Date;
  /** Scheduled run time, needed to turn a boarding time into an arrival. */
  runSeconds: number | null;
}): boolean | null {
  const { fares, timeZone, direction, boardAt, runSeconds } = args;

  let atTerminal: Date;
  if (direction === 'OUTBOUND') {
    atTerminal = boardAt;
  } else {
    if (runSeconds === null) return null;
    atTerminal = new Date(boardAt.getTime() + runSeconds * 1000);
  }

  const t: LocalTime = localTimeIn(timeZone, atTerminal);
  if (!isWeekday(t) || isUsPublicHoliday(t)) return false;

  const windows = direction === 'INBOUND' ? fares.peakArrivalWindows : fares.peakDepartureWindows;
  return windows.some((w) => inWindow(t, w.startMin, w.endMin));
}

export interface RailFare {
  minMinor: number;
  maxMinor: number;
  /** True when there is one answer over the whole boarding horizon. */
  exact: boolean;
  /** Null when peak could not be determined, or does not apply to this table. */
  peak: boolean | null;
  /** What the same ticket costs bought from the conductor, where published. */
  onboardMinor: number | null;
  currency: string;
}

/**
 * Price the rail leg for a whole party.
 *
 * Each rider buys a ticket, so party size multiplies here rather than adding a
 * per-head surcharge the way a taxi meter does. Comparing one taxi fare against
 * one train fare for a family of four would flatter the train by four times.
 */
export function priceRailTrip(args: {
  system: RailSystem;
  trip: RailTrip;
  at: Date;
  passengers: number;
  /**
   * How far ahead to look when deciding whether the train is a peak one.
   *
   * The default covers not knowing which train the rider will actually catch
   * when they are leaving *now*. It is the wrong question when they are
   * choosing a departure time instead: a rider reading "if I go at 15:30" wants
   * the fare for a 15:30 train, not a blend of 15:30 and 16:15. The day view
   * passes 0 and gets the exact published fare for that minute.
   */
  horizonSeconds?: number;
}): RailFare {
  const { system, trip, at, passengers } = args;
  const horizonSeconds = args.horizonSeconds ?? BOARDING_HORIZON_SECONDS;
  const riders = Math.max(1, Math.trunc(passengers));

  if (trip.fare.kind === 'ZONE_PAIR') {
    const total = trip.fare.fareMinor * riders;
    return {
      minMinor: total,
      maxMinor: total,
      exact: true,
      // This operator charges one fare all day; there is no peak to report.
      peak: null,
      onboardMinor: null,
      currency: system.currency,
    };
  }

  /* istanbul ignore next -- the fare basis and the table are built together. */
  if (system.fares.kind !== 'TO_TERMINAL') throw new Error('fare basis does not match the table');
  const fares = system.fares;
  const { zone, direction } = trip.fare;

  const shared = { fares, timeZone: system.timeZone, direction, runSeconds: trip.runSeconds };
  const now = isPeakTrain({ ...shared, boardAt: at });
  const soon =
    horizonSeconds === 0
      ? now
      : isPeakTrain({ ...shared, boardAt: new Date(at.getTime() + horizonSeconds * 1000) });

  const peakTotal = zone.peakMinor * riders;
  const offTotal = zone.offPeakMinor * riders;
  const settled = now !== null && now === soon;
  const peak = settled ? now : null;

  return {
    minMinor: settled ? (peak === true ? peakTotal : offTotal) : Math.min(offTotal, peakTotal),
    maxMinor: settled ? (peak === true ? peakTotal : offTotal) : Math.max(offTotal, peakTotal),
    exact: settled,
    peak,
    onboardMinor: (peak === true ? zone.onboardPeakMinor : zone.onboardOffPeakMinor) * riders,
    currency: system.currency,
  };
}

/**
 * The local minutes at which this trip's fare can change.
 *
 * Peak is defined at the terminal, so an outbound fare changes exactly at the
 * window edges — but an inbound one changes when the rider *boards*, which is
 * the run time earlier. A train arriving at 10:00 is the last peak train, so
 * the fare steps down for anybody boarding after 10:00 minus the run.
 *
 * Midnight is always a boundary because weekends and holidays are off-peak all
 * day, and the day can turn over inside the sampled window.
 */
export function railFareBoundaries(system: RailSystem, trip: RailTrip): number[] {
  if (system.fares.kind !== 'TO_TERMINAL' || trip.fare.kind !== 'TO_TERMINAL') return [];
  const inbound = trip.fare.direction === 'INBOUND';
  const windows = inbound ? system.fares.peakArrivalWindows : system.fares.peakDepartureWindows;
  const shiftMinutes = inbound ? Math.trunc((trip.runSeconds ?? 0) / 60) : 0;

  const out = new Set<number>([0]);
  for (const w of windows) {
    for (const edge of [w.startMin, w.endMin]) {
      out.add((((edge - shiftMinutes) % 1440) + 1440) % 1440);
    }
  }
  return [...out].sort((a, b) => a - b);
}
