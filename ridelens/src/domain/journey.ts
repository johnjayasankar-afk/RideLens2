/**
 * A trip has two ends, and the product kept counting one.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ "ALL IN" WAS NOT ALL IN                                                  │
 * │                                                                          │
 * │ The Loop to O'Hare returned a $5.50 Metra fare against a $58.43 cab. The │
 * │ verdict read "About 54 min all in — 37 on the timetable and about 17     │
 * │ walking to the platform, against 44 min by road", and every part of that │
 * │ sentence was checked except the part that mattered.                      │
 * │                                                                          │
 * │ The train's far end is Bensenville. Bensenville is 3.4 km from the O'Hare│
 * │ terminal. The fare does not get the rider to the airport, the card never │
 * │ named the station they would be standing at, and a total announcing      │
 * │ itself as "all in" had quietly dropped the larger of the two walks.      │
 * │                                                                          │
 * │ WHAT THIS MODULE EXISTS TO PREVENT                                       │
 * │ • A duration presented as door to door that measures platform to platform│
 * │ • A saving compared between a trip that arrives and one that does not    │
 * │ • A boarding station named while the alighting station stays a secret    │
 * │                                                                          │
 * │ The rule is not "add the walks". It is that a total is only claimed when │
 * │ every leg of the journey is known and walkable, and that when it is not, │
 * │ the product says which leg it cannot cover instead of rounding it to     │
 * │ zero.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { WALKABLE_METERS, WALK_METERS_PER_SECOND, type WalkBasis } from '@/location/walking';

export { WALKABLE_METERS };

/** Getting to the first platform, or away from the last one. */
export interface AccessLeg {
  /** The station or dock this leg reaches, as the operator names it. */
  station: string;
  meters: number;
  seconds: number;
  /** Measured on a pedestrian graph, or estimated across the rooftops. */
  basis: WalkBasis;
}

export function isWalkable(leg: AccessLeg): boolean {
  return leg.meters <= WALKABLE_METERS;
}

/**
 * Why a door-to-door total could not be stated.
 *
 * Distinguished because they are different problems for the rider. A boarding
 * point too far to walk to is a trip that needs a lift to the station and is
 * still worth considering. An alighting point too far to walk from is a fare
 * that does not finish the journey — which is the more serious of the two, and
 * the one the product was getting wrong.
 */
export type JourneyGap = 'BOARD_TOO_FAR' | 'ALIGHT_TOO_FAR' | 'BOTH_TOO_FAR';

export interface Journey {
  /** Walking to the first platform. Null when the operator comes to the door. */
  board: AccessLeg | null;
  /** The operator's own published run, platform to platform. */
  rideSeconds: number | null;
  /** Walking from the last platform. Null when it ends at the destination. */
  alight: AccessLeg | null;
  /**
   * Door to door, in seconds — and only when every leg is known and walkable.
   * Null is a refusal to guess, not a missing value.
   */
  totalSeconds: number | null;
  /** Which leg defeated the total, when one did. */
  gap: JourneyGap | null;
  /** True when at least one leg was measured rather than estimated. */
  routed: boolean;
  /**
   * True when any leg this journey counts came from a straight line.
   *
   * A straight line is the shortest path that could possibly exist between two
   * points, so a time derived from one is not an approximation — it is a floor.
   * Every figure resting on such a leg is therefore a lower bound, and the copy
   * says "at least" rather than "about", which is both more honest and more
   * useful than a hedge that could go either way.
   */
  estimated: boolean;
}

/**
 * Assemble the legs into a journey, and decide whether a total may be claimed.
 *
 * Both access legs are optional because not every mode has them: a taxi is
 * summoned to the door at one end and stops at the other, so a road fare has
 * neither and its ride time already IS the journey.
 */
export function buildJourney(
  board: AccessLeg | null,
  rideSeconds: number | null,
  alight: AccessLeg | null,
): Journey {
  const boardFar = board !== null && !isWalkable(board);
  const alightFar = alight !== null && !isWalkable(alight);

  const gap: JourneyGap | null =
    boardFar && alightFar
      ? 'BOTH_TOO_FAR'
      : alightFar
        ? 'ALIGHT_TOO_FAR'
        : boardFar
          ? 'BOARD_TOO_FAR'
          : null;

  /*
   * No ride time is not the same as a zero-length ride, and a gap is not the
   * same as a short walk. Either one means there is no honest total, and the
   * caller gets null rather than a number that looks complete.
   */
  const totalSeconds =
    rideSeconds === null || gap !== null
      ? null
      : rideSeconds + (board?.seconds ?? 0) + (alight?.seconds ?? 0);

  return {
    board,
    rideSeconds,
    alight,
    totalSeconds,
    gap,
    routed: board?.basis === 'ROUTED' || alight?.basis === 'ROUTED',
    /*
     * Only legs that are actually counted can weaken the total. A leg beyond
     * walking range is reported as a distance and never added, so however it
     * was derived it cannot make the sum a lower bound — there is no sum.
     */
    estimated:
      (board !== null && isWalkable(board) && board.basis === 'ESTIMATED') ||
      (alight !== null && isWalkable(alight) && alight.basis === 'ESTIMATED'),
  };
}

/**
 * Whether this journey actually arrives at the destination the rider asked for.
 *
 * A fare that leaves someone two miles short has not completed the trip, and
 * comparing its price with one that did is comparing two different journeys.
 * The verdict uses this to decide whether a saving may be called a saving.
 */
export function arrivesAtDestination(journey: Journey): boolean {
  return journey.gap !== 'ALIGHT_TOO_FAR' && journey.gap !== 'BOTH_TOO_FAR';
}

/**
 * Read a journey out of a quote's metadata bag.
 *
 * Rail and bike share publish the same idea under different keys, because the
 * two sources were written months apart against different operators' language
 * — `boardStation`/`alightStation` for a railroad, `startStation`/`endStation`
 * for a dock. Rather than migrate two source contracts and the fixtures behind
 * them, the shapes are reconciled here, once, where every reader can see both.
 *
 * A bike is the one mode whose own duration is already door to door: the
 * operator's planner counts the walk to the dock and from the far one, so its
 * legs are described for the reader but never added again.
 */
export function journeyOf(quote: {
  normalizedCategory: string;
  tripDurationSeconds: number | null;
  metadata: Readonly<Record<string, unknown>>;
}): Journey | null {
  const m = quote.metadata;
  const bike = quote.normalizedCategory === 'BIKE';

  const board = legOf(
    str(m.boardStation) ?? str(m.startStation),
    num(m.boardAccessMeters) ?? num(m.startWalkMeters),
    num(m.boardAccessSeconds) ?? num(m.startWalkSeconds),
    basisOf(m.boardAccessBasis),
  );
  const alight = legOf(
    str(m.alightStation) ?? str(m.endStation),
    num(m.alightAccessMeters) ?? num(m.endWalkMeters),
    num(m.alightAccessSeconds) ?? num(m.endWalkSeconds),
    basisOf(m.alightAccessBasis),
  );
  if (board === null && alight === null) return null;

  /*
   * A bike's published duration is already door to door — the operator's own
   * planner counts the walk to the dock and from the far one. Adding the legs
   * to it would charge the rider for those walks twice, so the ride leg here is
   * what is left when they are taken out, and the total comes back to exactly
   * the figure the operator published.
   */
  const ride =
    bike && quote.tripDurationSeconds !== null
      ? Math.max(0, quote.tripDurationSeconds - (board?.seconds ?? 0) - (alight?.seconds ?? 0))
      : quote.tripDurationSeconds;

  return buildJourney(board, ride, alight);
}

function legOf(
  station: string | null,
  meters: number | null,
  seconds: number | null,
  basis: WalkBasis,
): AccessLeg | null {
  if (station === null || meters === null) return null;
  return {
    station,
    meters,
    // A source that publishes a distance but no time predates the pedestrian
    // router. Falling back to the planning pace keeps it readable rather than
    // dropping the leg entirely.
    seconds: seconds ?? meters / WALK_METERS_PER_SECOND,
    basis: seconds === null ? 'ESTIMATED' : basis,
  };
}

function basisOf(v: unknown): WalkBasis {
  return v === 'ROUTED' ? 'ROUTED' : 'ESTIMATED';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The journey as drawn: legs in order, each sized by what it costs the rider.
 *
 * A single "37 min trip" hides the shape of a trip completely. Drawn in
 * proportion, the Loop to O'Hare reads at a glance as a twenty-minute walk
 * attached to a thirty-seven-minute train that stops two miles short — which
 * is the fact a rider needs and the one the old card could not express.
 */
export type SegmentKind = 'WALK' | 'RIDE' | 'GAP';

export interface JourneySegment {
  kind: SegmentKind;
  /**
   * Seconds, for a leg whose duration this product is willing to claim.
   * Left unrounded: minutes are a presentation decision and belong upstairs.
   */
  seconds: number | null;
  /** Metres, carried for the gap, where distance is the honest unit. */
  meters: number | null;
  /** Where this leg ends. */
  to: string | null;
  /** Share of the drawn width, 0–1. Sums to 1 across the returned segments. */
  share: number;
}

/**
 * A gap is drawn at a fixed width rather than in proportion.
 *
 * Sizing it by the walk we estimated would assert that the rider walks it, and
 * the whole point of a gap is that this product does not know how they will
 * cover it — on foot, by bus, by a second cab. It gets enough width to be
 * plainly visible and no more, and it is drawn open rather than filled.
 */
const GAP_SHARE = 0.22;

/** Below this a segment is drawn wider than its share, or it vanishes. */
const MIN_SHARE = 0.08;

export function journeySegments(journey: Journey): JourneySegment[] {
  /*
   * Leg-driven, not gap-driven.
   *
   * The first cut asked `journey.gap` which end was the problem, which works
   * until BOTH ends are — and then it drew one gap, at the far end, and the
   * boarding station the rider also could not walk to disappeared from the bar
   * and from the sentence beside it. A trip from a Scarsdale side street to
   * Chelsea is exactly that trip, and it read as though the near end were fine.
   *
   * Each leg now answers for itself: walkable legs are drawn in proportion,
   * unwalkable ones are drawn open, and the order is always the order the
   * rider travels in.
   */
  const of = (leg: AccessLeg | null): JourneySegment | null => {
    if (leg === null) return null;
    return isWalkable(leg)
      ? { kind: 'WALK', seconds: leg.seconds, meters: leg.meters, to: leg.station, share: 0 }
      : { kind: 'GAP', seconds: null, meters: leg.meters, to: leg.station, share: GAP_SHARE };
  };

  const board = of(journey.board);
  const ride: JourneySegment | null =
    journey.rideSeconds === null || journey.rideSeconds <= 0
      ? null
      : {
          kind: 'RIDE',
          seconds: journey.rideSeconds,
          meters: null,
          to: journey.alight?.station ?? null,
          share: 0,
        };
  const alight = of(journey.alight);

  const ordered = [board, ride, alight].filter((s): s is JourneySegment => s !== null);
  if (ordered.length === 0) return [];

  const timed = ordered.filter((s) => s.kind !== 'GAP');
  const gaps = ordered.length - timed.length;
  if (timed.length === 0) {
    // Nothing but gaps: split the bar between them rather than leaving it empty.
    return ordered.map((s) => ({ ...s, share: 1 / ordered.length }));
  }

  const room = 1 - gaps * GAP_SHARE;
  const total = timed.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
  let scaled = ordered.map((s) =>
    s.kind === 'GAP' ? s : { ...s, share: ((s.seconds ?? 0) / total) * room },
  );

  /*
   * A three-minute walk beside a fifty-minute train is a sliver no eye can
   * read. Floors are applied and the surplus is taken back proportionally from
   * the segments that can afford it, so the bar still sums to its room.
   */
  const floor = MIN_SHARE * room;
  const short = scaled.filter((s) => s.kind !== 'GAP' && s.share < floor);
  if (short.length > 0 && short.length < timed.length) {
    const owed = short.reduce((sum, s) => sum + (floor - s.share), 0);
    const donors = scaled.filter((s) => s.kind !== 'GAP' && s.share >= floor);
    const donorTotal = donors.reduce((sum, s) => sum + s.share, 0);
    scaled = scaled.map((s) =>
      s.kind === 'GAP'
        ? s
        : s.share < floor
          ? { ...s, share: floor }
          : { ...s, share: s.share - owed * (s.share / donorTotal) },
    );
  }

  return scaled;
}
