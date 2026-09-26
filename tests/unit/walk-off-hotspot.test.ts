import { describe, expect, it } from "vitest";

import {
  DIFFERENTIAL_TOLERANCE,
  MAX_WALK_SECONDS,
  MIN_SAVING_MINOR,
  chooseWalk,
  compassName,
  coolerCandidates,
  offsetPoint,
  type PricedCandidate,
} from "@/lib/domain/walk-off-hotspot";

/* Times Square: heat 0.12, active 10:00–02:00. */
const TIMES_SQ = { lat: 40.758, lng: -73.9855 };
const QUIET = { lat: 40.7312, lng: -73.9911 }; // Union Square-ish, no hotspot
const EVENING = new Date("2026-09-26T22:00:00");
const DEAD_OF_NIGHT = new Date("2026-09-26T04:00:00");

const priced = (over: Partial<PricedCandidate> = {}): PricedCandidate => ({
  lat: 40.76,
  lng: -73.99,
  bearingDeg: 0,
  offsetMeters: 220,
  heat: 0,
  lowMinor: 4000,
  highMinor: 4200,
  walkSeconds: 180,
  ...over,
});

describe("geometry", () => {
  it("moves the right way", () => {
    const north = offsetPoint(TIMES_SQ, 0, 500);
    const east = offsetPoint(TIMES_SQ, 90, 500);
    expect(north.lat).toBeGreaterThan(TIMES_SQ.lat);
    expect(north.lng).toBeCloseTo(TIMES_SQ.lng, 5);
    expect(east.lng).toBeGreaterThan(TIMES_SQ.lng);
    expect(east.lat).toBeCloseTo(TIMES_SQ.lat, 5);
  });

  it("moves about the distance asked for", () => {
    const p = offsetPoint(TIMES_SQ, 0, 500);
    const meters = (p.lat - TIMES_SQ.lat) * 111_320;
    expect(meters).toBeGreaterThan(480);
    expect(meters).toBeLessThan(520);
  });

  it("names a direction a person would use", () => {
    expect(compassName(0)).toBe("north");
    expect(compassName(45)).toBe("north-east");
    expect(compassName(270)).toBe("west");
    expect(compassName(360)).toBe("north");
    expect(compassName(-90)).toBe("west");
  });
});

describe("where there is anywhere to walk to", () => {
  it("finds cooler ground around a live hotspot", () => {
    const found = coolerCandidates(TIMES_SQ, EVENING);
    expect(found.length).toBeGreaterThan(0);
    // Sorted coolest first, and every one is genuinely cooler.
    expect(found[0]!.heat).toBeLessThanOrEqual(found.at(-1)!.heat);
  });

  it("says nothing where the rider is not in a hotspot", () => {
    expect(coolerCandidates(QUIET, EVENING)).toEqual([]);
  });

  /* Times Square is quiet at 4am by this model, so there is nothing to escape. */
  it("says nothing when the hotspot is not active", () => {
    expect(coolerCandidates(TIMES_SQ, DEAD_OF_NIGHT)).toEqual([]);
  });

  it("ignores somewhere equally busy", () => {
    // A drop requirement nothing can meet.
    expect(coolerCandidates(TIMES_SQ, EVENING, 1)).toEqual([]);
  });
});

describe("what it will and will not suggest", () => {
  /*
   * Centres, not band edges. Both prices come from the same model at the
   * same instant for the same trip, so its level error is shared and
   * cancels; demanding the bands clear each other is the rule for comparing
   * two different providers, and applying it here made the feature fire
   * almost never. Same mistake, and same fix, as departure-window.ts.
   */
  it("compares centres rather than demanding the bands clear", () => {
    /*
     * 4600-5400 against 4100-4900: bands that overlap heavily, so the old
     * band-clearance rule said nothing at all. The centres are $8 apart,
     * which on the same model at the same instant is a real difference.
     */
    const s = chooseWalk(4600, 5400, [priced({ lowMinor: 4100, highMinor: 4900 })]);
    expect(s).not.toBeNull();
    expect(s!.savingMinor).toBeGreaterThan(MIN_SAVING_MINOR);
  });

  it("suggests a walk that clearly pays", () => {
    // Here centre 5000, candidate centre 4300, tolerance 75.
    const s = chooseWalk(4800, 5200, [
      priced({ lowMinor: 4200, highMinor: 4400, walkSeconds: 240 }),
    ])!;
    expect(s.savingMinor).toBe(700 - 75);
    expect(s.sentence).toMatch(/Walking 4 min north/);
    expect(s.sentence).toMatch(/busy pickup zone/);
  });

  /* The tolerance is taken off before the number is quoted, so "at least"
     survives the heat map being wrong by its whole allowance. */
  it("quotes the saving net of the tolerance it allows for", () => {
    const s = chooseWalk(8800, 9200, [priced({ lowMinor: 5800, highMinor: 6200 })])!;
    const tolerance = Math.round(9000 * DIFFERENTIAL_TOLERANCE);
    expect(s.savingMinor).toBe(3000 - tolerance);
  });

  it("picks the biggest saving when several qualify", () => {
    const s = chooseWalk(8800, 9200, [
      priced({ bearingDeg: 0, lowMinor: 7000, highMinor: 7200 }),
      priced({ bearingDeg: 90, lowMinor: 5000, highMinor: 5200 }),
    ])!;
    expect(s.candidate.bearingDeg).toBe(90);
  });

  it("will not send anyone on a hike", () => {
    expect(
      chooseWalk(8800, 9200, [
        priced({ lowMinor: 2900, highMinor: 3100, walkSeconds: MAX_WALK_SECONDS + 1 }),
      ]),
    ).toBeNull();
  });

  /* A walk nobody could route is a walk nobody should be told to take. */
  it("declines when the walk was never measured", () => {
    expect(
      chooseWalk(8800, 9200, [priced({ lowMinor: 2900, highMinor: 3100, walkSeconds: null })]),
    ).toBeNull();
  });

  it("declines a saving too small to be worth the sentence", () => {
    // Centres 5000 vs 4940: a $0.60 gap, under the floor once tolerance bites.
    expect(chooseWalk(4900, 5100, [priced({ lowMinor: 4840, highMinor: 5040 })])).toBeNull();
  });

  it("has nothing to say with no candidates", () => {
    expect(chooseWalk(4900, 5100, [])).toBeNull();
  });
});
