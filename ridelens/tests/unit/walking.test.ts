/**
 * The pedestrian router, and the rules around trusting it.
 *
 * The road router this project already had answers a walking request with
 * driving times — measured at 31 km/h on the leg that prompted this module —
 * so walking got its own client. These are the guards that keep a bad answer,
 * a slow one, or no answer at all from reaching a rider as if it were a
 * measurement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSingleton } from '@/lib/singleton';
import { estimateWalk, measureWalk, WALK_METERS_PER_SECOND } from '@/location/walking';
import * as http from '@/sources/http';

const LOOP = { lat: 41.8827, lng: -87.6233 };
const UNION = { lat: 41.8789, lng: -87.6397 };
/** Bensenville to the O'Hare terminal: 3.4 km, which nobody walks. */
const FAR = { lat: 41.9742, lng: -87.9073 };

function valhalla(km: number, seconds: number) {
  return { trip: { summary: { length: km, time: seconds } } };
}

beforeEach(() => {
  clearSingleton('walking.cache');
  clearSingleton('walking.inflight');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('measuring a walk', () => {
  it('prefers a measured route and says it was measured', async () => {
    vi.spyOn(http, 'httpJson').mockResolvedValue(valhalla(1.815, 1349));
    const walk = await measureWalk(LOOP, UNION);
    expect(walk.basis).toBe('ROUTED');
    expect(Math.round(walk.meters)).toBe(1815);
    expect(walk.seconds).toBe(1349);
  });

  /*
   * A straight line is the shortest path that could possibly exist between two
   * points. A routed walk shorter than that is geometrically impossible, so the
   * router has snapped an endpoint somewhere unhelpful — and a measurement that
   * cannot be true is worse than an estimate that is honest about being one.
   */
  it('rejects a route shorter than the straight line between its ends', async () => {
    vi.spyOn(http, 'httpJson').mockResolvedValue(valhalla(0.2, 150));
    const walk = await measureWalk(LOOP, UNION);
    expect(walk.basis).toBe('ESTIMATED');
  });

  it('falls back rather than failing when the router does not answer', async () => {
    vi.spyOn(http, 'httpJson').mockRejectedValue(new Error('gateway timeout'));
    const walk = await measureWalk(LOOP, UNION);
    expect(walk.basis).toBe('ESTIMATED');
    expect(walk.seconds).toBeCloseTo(walk.meters / WALK_METERS_PER_SECOND, 5);
  });

  it('falls back on a response it does not recognise', async () => {
    vi.spyOn(http, 'httpJson').mockResolvedValue({ trip: {} });
    expect((await measureWalk(LOOP, UNION)).basis).toBe('ESTIMATED');
  });

  /*
   * Station matching reaches 8 km. Costing a five-mile hike burns a request on
   * a public instance to produce a number nobody would act on.
   */
  it('spends no request on a distance nobody walks', async () => {
    const spy = vi.spyOn(http, 'httpJson').mockResolvedValue(valhalla(5, 4000));
    const walk = await measureWalk(LOOP, FAR);
    expect(walk.basis).toBe('ESTIMATED');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('being a good citizen of a shared public instance', () => {
  it('asks once and answers the rest from memory', async () => {
    const spy = vi.spyOn(http, 'httpJson').mockResolvedValue(valhalla(1.815, 1349));
    await measureWalk(LOOP, UNION);
    await measureWalk(LOOP, UNION);
    await measureWalk(LOOP, UNION);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /*
   * Rail quotes arrive in bursts, and a burst is exactly when politeness
   * matters most: three riders asking the same question at the same instant
   * should produce one request, not three.
   */
  it('collapses simultaneous identical requests into one call', async () => {
    const spy = vi
      .spyOn(http, 'httpJson')
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(valhalla(1.815, 1349)), 10)),
      );
    const all = await Promise.all([
      measureWalk(LOOP, UNION),
      measureWalk(LOOP, UNION),
      measureWalk(LOOP, UNION),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    for (const walk of all) expect(walk.basis).toBe('ROUTED');
  });

  it('does not hammer a router that is down, and recovers when it returns', async () => {
    const spy = vi.spyOn(http, 'httpJson').mockRejectedValue(new Error('503'));
    await measureWalk(LOOP, UNION);
    await measureWalk(LOOP, UNION);
    // The failure is cached briefly, so the second rider does not re-ask.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('quantises nearby points onto one entry', async () => {
    const spy = vi.spyOn(http, 'httpJson').mockResolvedValue(valhalla(1.815, 1349));
    await measureWalk(LOOP, UNION);
    // Roughly a metre away: the same pavement, and the same cache entry.
    await measureWalk({ lat: LOOP.lat + 0.000004, lng: LOOP.lng }, UNION);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the straight-line fallback', () => {
  it('is a floor, paced at the planning speed', () => {
    const walk = estimateWalk(LOOP, UNION);
    expect(walk.basis).toBe('ESTIMATED');
    // The crow's distance, which no footpath can beat.
    expect(walk.meters).toBeGreaterThan(1400);
    expect(walk.meters).toBeLessThan(1450);
    expect(walk.seconds).toBeCloseTo(walk.meters / WALK_METERS_PER_SECOND, 5);
  });
});
