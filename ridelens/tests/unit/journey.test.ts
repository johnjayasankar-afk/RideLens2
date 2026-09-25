/**
 * A trip has two ends.
 *
 * The product spent five cycles treating a railroad's platform-to-platform run
 * as "the trip". These are the rules that stop it doing so again: a total is
 * claimed only when every leg is known and walkable, a fare that stops short
 * says so, and nothing is added to a duration that already contains it.
 */
import { describe, expect, it } from 'vitest';
import {
  arrivesAtDestination,
  buildJourney,
  journeyOf,
  journeySegments,
  type AccessLeg,
} from '@/domain/journey';
import { journeyLine, placeName } from '@/ui/JourneyStrip';

const leg = (station: string, meters: number, seconds: number): AccessLeg => ({
  station,
  meters,
  seconds,
  basis: 'ROUTED',
});

describe('when a total may be claimed', () => {
  it('adds every leg, not just the middle one', () => {
    const j = buildJourney(leg('Union Station', 1766, 1311), 2220, leg('Oak Park', 400, 300));
    expect(j.totalSeconds).toBe(1311 + 2220 + 300);
    expect(j.gap).toBeNull();
    expect(arrivesAtDestination(j)).toBe(true);
  });

  /*
   * Bensenville is 3.4 km from the O'Hare terminal. The shipped bar said
   * "About 54 min all in", having counted the walk at one end and dropped the
   * larger one at the other. There is no honest total for this trip, and null
   * is a refusal rather than a missing value.
   */
  it('refuses a total when the fare stops short of the destination', () => {
    const j = buildJourney(leg('Union Station', 1766, 1311), 2220, leg('Bensenville', 3447, 2553));
    expect(j.totalSeconds).toBeNull();
    expect(j.gap).toBe('ALIGHT_TOO_FAR');
    expect(arrivesAtDestination(j)).toBe(false);
  });

  it('distinguishes a station you cannot walk TO from one you cannot walk FROM', () => {
    const farBoard = buildJourney(leg('Ossining', 6_000, 4_400), 2220, leg('GCT', 400, 300));
    expect(farBoard.gap).toBe('BOARD_TOO_FAR');
    // Still gets you there — it just needs a lift to the platform first.
    expect(arrivesAtDestination(farBoard)).toBe(true);

    const both = buildJourney(
      leg('Ossining', 6_000, 4_400),
      2220,
      leg('Bensenville', 3_447, 2_553),
    );
    expect(both.gap).toBe('BOTH_TOO_FAR');
    expect(arrivesAtDestination(both)).toBe(false);
  });

  it('claims nothing when the operator publishes no run time', () => {
    expect(buildJourney(leg('Union Station', 500, 400), null, null).totalSeconds).toBeNull();
  });
});

describe('reading a journey out of a quote', () => {
  /*
   * A bike's own duration already spans both walks — the operator's planner
   * counts them. Adding the legs again would charge the rider for the same
   * walk twice, so the ride leg is the remainder and the total comes back to
   * exactly the number the operator published.
   */
  it('never counts a bike’s walks twice', () => {
    const j = journeyOf({
      normalizedCategory: 'BIKE',
      tripDurationSeconds: 2040,
      metadata: {
        startStation: '20th & O St NW',
        startWalkMeters: 120,
        startWalkSeconds: 90,
        endStation: 'Constitution Ave',
        endWalkMeters: 494,
        endWalkSeconds: 370,
      },
    })!;
    expect(j.totalSeconds).toBe(2040);
    expect(j.rideSeconds).toBe(2040 - 90 - 370);
    // The legs are still there to draw and to name.
    expect(j.board?.station).toBe('20th & O St NW');
    expect(j.alight?.station).toBe('Constitution Ave');
  });

  it('reconciles the two vocabularies the sources use', () => {
    const rail = journeyOf({
      normalizedCategory: 'TRANSIT',
      tripDurationSeconds: 2940,
      metadata: { boardStation: 'Hartsdale', boardAccessMeters: 1897, boardAccessSeconds: 1387 },
    })!;
    expect(rail.board?.station).toBe('Hartsdale');
    expect(rail.board?.seconds).toBe(1387);
  });

  it('returns nothing for a mode that has no legs at all', () => {
    expect(
      journeyOf({ normalizedCategory: 'TAXI', tripDurationSeconds: 1800, metadata: {} }),
    ).toBeNull();
  });

  /*
   * A source that publishes a distance but no time predates the pedestrian
   * router. The leg is kept and marked estimated rather than dropped, because
   * a trip whose access is unstated reads as a trip with no access.
   */
  it('falls back to a paced estimate, and says that is what it did', () => {
    const j = journeyOf({
      normalizedCategory: 'TRANSIT',
      tripDurationSeconds: 900,
      metadata: { boardStation: 'Rye', boardAccessMeters: 1350 },
    })!;
    expect(j.board?.basis).toBe('ESTIMATED');
    expect(j.board?.seconds).toBeCloseTo(1350 / 1.35, 5);
    expect(j.routed).toBe(false);
  });
});

describe('drawing the journey to scale', () => {
  it('sizes the legs by what they cost the rider', () => {
    const segs = journeySegments(
      buildJourney(leg('Union Station', 1766, 1311), 2220, leg('Oak Park', 400, 300)),
    );
    expect(segs.map((s) => s.kind)).toEqual(['WALK', 'RIDE', 'WALK']);
    expect(segs.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 6);
    // The train is the longest leg, so it is the widest.
    expect(segs[1]!.share).toBeGreaterThan(segs[0]!.share);
    expect(segs[0]!.share).toBeGreaterThan(segs[2]!.share);
  });

  it('draws the uncovered stretch last, open, and in distance', () => {
    const segs = journeySegments(
      buildJourney(leg('Union Station', 1766, 1311), 2220, leg('Bensenville', 3447, 2553)),
    );
    expect(segs.map((s) => s.kind)).toEqual(['WALK', 'RIDE', 'GAP']);
    const gap = segs[2]!;
    // No time is asserted for a stretch whose mode is unknown.
    expect(gap.seconds).toBeNull();
    expect(gap.meters).toBe(3447);
    expect(segs.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 6);
  });

  it('puts an unreachable boarding point first, where it happens', () => {
    const segs = journeySegments(buildJourney(leg('Ossining', 6000, 4400), 2220, null));
    expect(segs.map((s) => s.kind)).toEqual(['GAP', 'RIDE']);
  });

  it('keeps a short leg visible instead of letting it vanish', () => {
    // Three minutes against fifty is a sliver no eye can read.
    const segs = journeySegments(buildJourney(leg('Dock', 200, 180), 3000, null));
    expect(segs[0]!.share).toBeGreaterThanOrEqual(0.079);
    expect(segs.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 6);
  });
});

describe('the sentence beside the bar', () => {
  it('names both ends and the door-to-door total', () => {
    const line = journeyLine(
      buildJourney(leg('Union Station', 1766, 1311), 2220, leg('Oak Park', 400, 300)),
      'Oak Park, IL',
    );
    expect(line).toBe(
      '22 min walk to Union Station, 37 min on board to Oak Park, 5 min walk at the other end — about 64 min door to door.',
    );
  });

  /*
   * The sentence this whole cycle was written for. It says "short of" rather
   * than "from", because a rider needs to understand that the fare stops
   * before the journey does.
   */
  it('says how far short the fare stops, and of where', () => {
    const line = journeyLine(
      buildJourney(leg('Union Station', 1766, 1311), 2220, leg('Bensenville', 3447, 2553)),
      "O'Hare Airport",
    );
    expect(line).toBe(
      "22 min walk to Union Station, 37 min on board to Bensenville — which leaves you 2.1 mi short of O'Hare Airport.",
    );
    // And no total is smuggled in beside it.
    expect(line).not.toContain('door to door');
  });

  it('falls back to plain words when the destination has no label', () => {
    const line = journeyLine(
      buildJourney(leg('Union Station', 1766, 1311), 2220, leg('Bensenville', 3447, 2553)),
      null,
    );
    expect(line).toContain('short of where you asked to go');
  });

  it('says a boarding point is out of walking range rather than timing the walk', () => {
    const line = journeyLine(buildJourney(leg('Ossining', 6000, 4400), 2220, null), 'Manhattan');
    expect(line).toContain('Ossining is 3.7 mi away, too far to walk');
    expect(line).not.toContain('73 min walk');
  });
});

/*
 * The router can be down, and when it is, every walk quietly becomes a straight
 * line — which is the shortest path that could possibly exist, and therefore
 * about a third short of the real one. A card that reads identically either way
 * is a failed integration in hiding, which is the one thing this product's own
 * rules forbid. The distinction is carried in the words.
 */
describe('a walk that was guessed rather than measured', () => {
  const estimated = (station: string, meters: number, seconds: number): AccessLeg => ({
    station,
    meters,
    seconds,
    basis: 'ESTIMATED',
  });

  it('is a floor, and says so', () => {
    const j = buildJourney(estimated('Union Station', 1358, 1006), 2220, null);
    expect(j.estimated).toBe(true);
    expect(journeyLine(j, null)).toContain('at least 17 min walk to Union Station');
    expect(journeyLine(j, null)).toContain('at least 54 min door to door');
  });

  it('leaves a measured walk unqualified', () => {
    const j = buildJourney(leg('Union Station', 1766, 1311), 2220, null);
    expect(j.estimated).toBe(false);
    const line = journeyLine(j, null);
    expect(line).toContain('22 min walk to Union Station');
    expect(line).not.toContain('at least');
    expect(line).toContain('about 59 min door to door');
  });

  it('one guessed leg is enough to make the whole total a floor', () => {
    const j = buildJourney(leg('A', 500, 370), 1200, estimated('B', 600, 444));
    expect(j.estimated).toBe(true);
    expect(journeyLine(j, null)).toContain('at least');
  });

  /*
   * A leg beyond walking range is reported as a distance and never added, so
   * however it was derived it cannot weaken a total that does not exist.
   */
  it('is not weakened by a leg it never counted', () => {
    const j = buildJourney(
      leg('Union Station', 1766, 1311),
      2220,
      estimated('Bensenville', 3447, 2553),
    );
    expect(j.estimated).toBe(false);
    expect(j.totalSeconds).toBeNull();
  });
});

/*
 * Both ends out of range at once.
 *
 * The first cut asked a single `gap` value which end was the problem, and when
 * the answer was "both" it reported only the far one. A Scarsdale side street
 * to Chelsea read as "49 min on board to Grand Central — which leaves you 1.7
 * mi short", with no hint that the boarding station was two miles the other
 * way. Caught by the live suite, not by eye.
 */
describe('when neither end is walkable', () => {
  const j = buildJourney(
    { station: 'Hartsdale', meters: 3_900, seconds: 2_889, basis: 'ESTIMATED' },
    2940,
    { station: 'Grand Central', meters: 2_749, seconds: 2_036, basis: 'ESTIMATED' },
  );

  it('reports both, not just the far one', () => {
    const line = journeyLine(j, 'Chelsea');
    expect(line).toContain('Hartsdale is 2.4 mi away, too far to walk');
    expect(line).toContain('49 min on board to Grand Central');
    expect(line).toContain('1.7 mi short of Chelsea');
  });

  it('draws a segment for each end, both open', () => {
    const segs = journeySegments(j);
    expect(segs.map((s) => s.kind)).toEqual(['GAP', 'RIDE', 'GAP']);
    expect(segs.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 6);
    // And the ride still has real width between them.
    expect(segs[1]!.share).toBeGreaterThan(0.4);
  });

  it('still claims no total', () => {
    expect(j.totalSeconds).toBeNull();
    expect(j.gap).toBe('BOTH_TOO_FAR');
  });
});

describe('naming the destination inside a sentence', () => {
  it('keeps the specific part and drops the postal chain', () => {
    expect(placeName('515 West 18th Street, New York, New York')).toBe('515 West 18th Street');
    expect(placeName('Chelsea, Manhattan')).toBe('Chelsea');
    expect(placeName("O'Hare Airport")).toBe("O'Hare Airport");
  });

  it('keeps a house number attached to its street', () => {
    expect(placeName('22, Murray Hill Road, Scarsdale')).toBe('22 Murray Hill Road');
  });

  it('falls back to plain words when there is no label', () => {
    expect(placeName(null)).toBe('where you asked to go');
    expect(placeName('   ')).toBe('where you asked to go');
  });
});
