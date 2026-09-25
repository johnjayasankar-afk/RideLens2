/**
 * The scoring, scored.
 *
 * Synthetic records here are fine and synthetic *ground truth* is not: these
 * exercise the arithmetic, they never feed docs/CALIBRATION.md. The corpus
 * loader enforces the difference by requiring an origin on every record.
 */
import { describe, expect, it } from "vitest";

import {
  MIN_SAMPLES,
  calibrationCurve,
  contains,
  coverageAdjustedSharpness,
  evaluate,
  groupValue,
  midpoint,
  position,
  summarise,
  type ActualRecord,
} from "@/lib/eval/metrics";

const rec = (over: Partial<ActualRecord> = {}): ActualRecord => ({
  routeHash: "r1",
  provider: "uber",
  marketId: "new-york",
  predictedMinMinor: 2000,
  predictedMaxMinor: 3000,
  actualMinor: 2500,
  predictedAt: "2026-03-04T14:00:00Z",
  modelVersion: "2026-09-25.v1",
  distanceMeters: 8000,
  ...over,
});

const many = (n: number, f: (i: number) => Partial<ActualRecord>): ActualRecord[] =>
  Array.from({ length: n }, (_, i) => rec(f(i)));

describe("the primitives", () => {
  it("finds the centre and whether a fare fell inside", () => {
    expect(midpoint({ min: 2000, max: 3000 })).toBe(2500);
    expect(contains({ min: 2000, max: 3000 }, 2000)).toBe(true);
    expect(contains({ min: 2000, max: 3000 }, 3000)).toBe(true);
    expect(contains({ min: 2000, max: 3000 }, 1999)).toBe(false);
  });

  /*
   * How far outside a miss landed is the interesting part, so position is not
   * clamped to [0, 1].
   */
  it("reports how far outside a miss landed", () => {
    expect(position({ min: 2000, max: 3000 }, 2500)).toBe(0.5);
    expect(position({ min: 2000, max: 3000 }, 4000)).toBe(2);
    expect(position({ min: 2000, max: 3000 }, 1000)).toBe(-1);
  });
});

describe("withholding below the minimum", () => {
  it("refuses to report a statistic from too few rides", () => {
    const s = summarise(many(MIN_SAMPLES - 1, () => ({})));
    expect(s.n).toBe(MIN_SAMPLES - 1);
    expect(s.coverage).toBeNull();
    expect(s.biasMinor).toBeNull();
    expect(s.meanRelativeWidth).toBeNull();
  });

  it("reports once there are enough", () => {
    expect(summarise(many(MIN_SAMPLES, () => ({}))).coverage).toBe(1);
  });

  it("draws no calibration curve from too few", () => {
    expect(calibrationCurve(many(5, () => ({})))).toEqual([]);
  });
});

describe("coverage and sharpness", () => {
  it("counts how often the actual landed inside", () => {
    // Half the rides land outside the band.
    const s = summarise(many(40, (i) => ({ actualMinor: i % 2 === 0 ? 2500 : 5000 })));
    expect(s.coverage).toBe(0.5);
  });

  it("measures width relative to the fare, so markets compare", () => {
    const s = summarise(
      many(20, () => ({ predictedMinMinor: 2000, predictedMaxMinor: 3000, actualMinor: 2500 })),
    );
    // 1000 wide on a 2500 midpoint.
    expect(s.meanRelativeWidth).toBeCloseTo(0.4, 5);
    expect(s.meanWidthMinor).toBe(1000);
  });

  /*
   * The point of the composite score: widening the band raises coverage and
   * must not raise the score, or the metric is a dial rather than a measure.
   */
  it("cannot be improved by widening the band", () => {
    const tight = summarise(
      many(30, (i) => ({
        predictedMinMinor: 2400,
        predictedMaxMinor: 2600,
        actualMinor: i < 24 ? 2500 : 4000,
      })),
    );
    const lazy = summarise(
      many(30, (i) => ({
        predictedMinMinor: 500,
        predictedMaxMinor: 50_000,
        actualMinor: i < 24 ? 2500 : 4000,
      })),
    );

    expect(lazy.coverage!).toBeGreaterThan(tight.coverage!);
    // ...and yet it scores worse, because the band is useless.
    expect(coverageAdjustedSharpness(lazy)!).toBeLessThan(coverageAdjustedSharpness(tight)!);
  });

  it("gives a perfect, useless band a poor score", () => {
    const useless = summarise(
      many(25, () => ({ predictedMinMinor: 500, predictedMaxMinor: 50_000, actualMinor: 2500 })),
    );
    expect(useless.coverage).toBe(1);
    // Perfect coverage, and a score that says plainly it is worth little.
    expect(coverageAdjustedSharpness(useless)!).toBeLessThan(0.15);

    // A genuinely good band scores several times higher on worse coverage.
    const good = summarise(
      many(25, (i) => ({
        predictedMinMinor: 2400,
        predictedMaxMinor: 2600,
        actualMinor: i < 20 ? 2500 : 4000,
      })),
    );
    expect(coverageAdjustedSharpness(good)!).toBeGreaterThan(
      coverageAdjustedSharpness(useless)! * 4,
    );
  });
});

describe("bias", () => {
  it("is positive when riders pay more than we said", () => {
    const s = summarise(many(25, () => ({ actualMinor: 3000 })));
    expect(s.biasMinor).toBe(500);
    expect(s.biasRelative).toBeCloseTo(0.2, 5);
  });

  it("is negative when we overquote", () => {
    expect(summarise(many(25, () => ({ actualMinor: 2000 }))).biasMinor).toBe(-500);
  });

  /*
   * Bias cancels and MAE does not, which is why both are reported: a model
   * that is $10 over half the time and $10 under the rest has zero bias and
   * is not accurate.
   */
  it("reports absolute error separately, because bias cancels", () => {
    const s = summarise(many(30, (i) => ({ actualMinor: i % 2 === 0 ? 1500 : 3500 })));
    expect(s.biasMinor).toBe(0);
    expect(s.maeMinor).toBe(1000);
  });

  it("says which side the misses fell on", () => {
    const s = summarise(many(25, (i) => ({ actualMinor: i < 20 ? 2500 : 500 })));
    expect(s.missedLowShare).toBe(1);
  });
});

describe("the calibration curve", () => {
  it("loses coverage as the band is squeezed", () => {
    const curve = calibrationCurve(
      many(40, (i) => ({
        predictedMinMinor: 2000,
        predictedMaxMinor: 3000,
        // Spread evenly across the band.
        actualMinor: 2000 + (i / 39) * 1000,
      })),
    );
    expect(curve).toHaveLength(5);
    expect(curve[0]!.observedCoverage).toBeLessThan(curve.at(-1)!.observedCoverage);
    // Monotone: squeezing can never admit more.
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.observedCoverage).toBeGreaterThanOrEqual(curve[i - 1]!.observedCoverage);
    }
  });
});

describe("slices", () => {
  it("buckets by hour, market, provider and distance", () => {
    expect(groupValue(rec({ predictedAt: "2026-03-04T08:30:00Z" }), "hour")).toBe("08:00");
    expect(groupValue(rec({ marketId: undefined }), "marketId")).toBe("unknown");
    expect(groupValue(rec({ distanceMeters: 1000 }), "distanceBand")).toBe("<2 mi");
    expect(groupValue(rec({ distanceMeters: 30_000 }), "distanceBand")).toBe("12+ mi");
    expect(groupValue(rec({ distanceMeters: undefined }), "distanceBand")).toBe("unknown");
  });

  it("withholds a slice that is too thin while reporting the whole", () => {
    const records = [
      ...many(25, () => ({ provider: "uber" })),
      ...many(3, () => ({ provider: "lyft" })),
    ];
    const report = evaluate(records);
    expect(report.overall.n).toBe(28);
    expect(report.overall.coverage).not.toBeNull();

    const lyft = report.slices.provider.find((s) => s.group === "lyft")!;
    expect(lyft.summary.n).toBe(3);
    expect(lyft.summary.coverage).toBeNull();
  });

  it("surfaces a corpus that spans two parameter sets", () => {
    const report = evaluate([
      ...many(10, () => ({ modelVersion: "a" })),
      ...many(10, () => ({ modelVersion: "b" })),
    ]);
    expect(report.modelVersions).toEqual(["a", "b"]);
  });
});
