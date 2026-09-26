/**
 * The forecast, and the things it must refuse to say.
 *
 * The arithmetic tests matter less than the two properties below them: a
 * projected number never appears without a band, and a later window is never
 * called cheaper unless its band clears. Everything else in this file is
 * scaffolding around those two.
 */
import { describe, expect, it } from "vitest";

import {
  adviseDeparture,
  buildDepartureWindow,
  differentialWidening,
  forecastConfidence,
  forecastProvider,
  horizonWidening,
  type ForecastInput,
  type ForecastPoint,
  type ProviderForecast,
} from "@/lib/domain/departure-window";
import { MODEL_PARAMS } from "@/lib/sources/ratecard/model-params";

/* A fixed clock: the marketplace model is deterministic given one. */
const NOW = new Date("2026-09-26T18:00:00Z");

const input = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  provider: "uber",
  product: "uberx",
  waitCategory: "STANDARD",
  pickup: { lat: 40.7549, lng: -73.984 },
  destination: { lat: 40.6413, lng: -73.7781 },
  miles: 17.4,
  osrmMinutes: 33,
  now: NOW,
  ...over,
});

const point = (over: Partial<ForecastPoint> = {}): ForecastPoint => ({
  minutesFromNow: 0,
  at: NOW.toISOString(),
  centerMinor: 5000,
  lowMinor: 4800,
  highMinor: 5200,
  waitSeconds: 180,
  waitLowSeconds: 120,
  waitHighSeconds: 240,
  /* Comparison uncertainty, narrower than the displayed band by design. */
  comparisonHalfMinor: (over.highMinor ?? 5200) - (over.centerMinor ?? 5000),
  confidence: "MEDIUM",
  ...over,
});

const forecast = (points: ForecastPoint[]): ProviderForecast => ({
  provider: "uber",
  product: "uberx",
  points,
  cheapest: points.reduce((a, b) => (b.centerMinor < a.centerMinor ? b : a)),
  modelVersion: MODEL_PARAMS.version,
});

describe("the shape of a forecast", () => {
  it("covers the whole horizon at the stated step", () => {
    const f = forecastProvider(input());
    const { horizonMinutes, stepMinutes } = MODEL_PARAMS.forecast;
    expect(f.points).toHaveLength(horizonMinutes / stepMinutes + 1);
    expect(f.points[0]!.minutesFromNow).toBe(0);
    expect(f.points.at(-1)!.minutesFromNow).toBe(horizonMinutes);
  });

  it("is deterministic given the same clock", () => {
    const a = forecastProvider(input());
    const b = forecastProvider(input());
    expect(a.points.map((p) => p.centerMinor)).toEqual(b.points.map((p) => p.centerMinor));
  });

  it("records which parameter set produced it", () => {
    expect(forecastProvider(input()).modelVersion).toBe(MODEL_PARAMS.version);
  });

  it("projects a wait as well as a price", () => {
    for (const p of forecastProvider(input()).points) {
      expect(p.waitSeconds).toBeGreaterThan(0);
      expect(p.waitLowSeconds).toBeLessThanOrEqual(p.waitHighSeconds);
    }
  });

  it("moves with the time of day rather than sitting flat", () => {
    const centers = forecastProvider(input()).points.map((p) => p.centerMinor);
    expect(new Set(centers).size).toBeGreaterThan(1);
  });
});

describe("no future number without a band", () => {
  /*
   * The property the whole module exists to hold. A point with low === high
   * is a claim to know the future exactly.
   */
  it("gives every projected point a real interval", () => {
    for (const p of forecastProvider(input()).points) {
      expect(p.lowMinor).toBeLessThan(p.highMinor);
      expect(p.lowMinor).toBeLessThanOrEqual(p.centerMinor);
      expect(p.highMinor).toBeGreaterThanOrEqual(p.centerMinor);
    }
  });

  it("widens as the horizon lengthens", () => {
    const pts = forecastProvider(input()).points;
    const widthAt = (m: number) => {
      const p = pts.find((x) => x.minutesFromNow === m)!;
      return (p.highMinor - p.lowMinor) / p.centerMinor;
    };
    expect(widthAt(60)).toBeGreaterThan(widthAt(0));
    expect(widthAt(30)).toBeGreaterThan(widthAt(0));
  });

  it("scales the widening linearly, and not at all for now", () => {
    expect(horizonWidening(0)).toBe(0);
    expect(horizonWidening(60)).toBeCloseTo(MODEL_PARAMS.forecast.horizonWideningPerHour, 6);
    expect(horizonWidening(30)).toBeCloseTo(MODEL_PARAMS.forecast.horizonWideningPerHour / 2, 6);
    expect(horizonWidening(-10)).toBe(0);
  });

  /* A projection is not a quote, at any horizon. */
  it("never reports high confidence", () => {
    for (const m of [0, 5, 20, 45, 60, 600]) {
      expect(forecastConfidence(m)).not.toBe("HIGH");
    }
  });

  it("loses confidence with distance", () => {
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1, UNCERTAIN: 0 } as const;
    const seq = [0, 20, 45, 60].map((m) => rank[forecastConfidence(m)]);
    for (let i = 1; i < seq.length; i += 1) {
      expect(seq[i]!).toBeLessThanOrEqual(seq[i - 1]!);
    }
  });
});

describe("refusing to recommend noise", () => {
  /*
   * The second property. marketplace-dynamics injects per-tick jitter that is
   * a hash of the tick index — up to 5.5% amplitude and completely
   * meaningless. A difference inside the bands must never become advice.
   */
  it("says nothing when the bands overlap", () => {
    const advice = adviseDeparture([
      forecast([
        point({ minutesFromNow: 0, centerMinor: 5000, lowMinor: 4800, highMinor: 5200 }),
        // Cheaper at the centre, but its band runs straight through the other.
        point({ minutesFromNow: 20, centerMinor: 4900, lowMinor: 4700, highMinor: 5100 }),
      ]),
    ]);
    expect(advice.kind).toBe("leave_now");
    expect(advice.savingMinor).toBeNull();
  });

  it("recommends waiting only once the later band clears entirely", () => {
    const advice = adviseDeparture([
      forecast([
        point({ minutesFromNow: 0, centerMinor: 5000, lowMinor: 4800, highMinor: 5200 }),
        point({ minutesFromNow: 25, centerMinor: 4000, lowMinor: 3900, highMinor: 4100 }),
      ]),
    ]);
    expect(advice.kind).toBe("wait");
    expect(advice.minutesFromNow).toBe(25);
    // 4800 - 4100: the part that clears, never the 1000 between centres.
    expect(advice.savingMinor).toBe(700);
  });

  it("quotes the clearance rather than the difference of centres", () => {
    const advice = adviseDeparture([
      forecast([
        point({ minutesFromNow: 0, centerMinor: 9000, lowMinor: 8000, highMinor: 10000 }),
        point({ minutesFromNow: 30, centerMinor: 5000, lowMinor: 4000, highMinor: 6000 }),
      ]),
    ]);
    expect(advice.savingMinor).toBe(2000); // 8000 - 6000, not 9000 - 5000.
  });

  it("ignores a clearance too small to matter", () => {
    const tiny = MODEL_PARAMS.forecast.minMeaningfulSavingMinor - 1;
    const advice = adviseDeparture([
      forecast([
        point({ minutesFromNow: 0, centerMinor: 5000, lowMinor: 5000, highMinor: 5000 }),
        point({
          minutesFromNow: 15,
          centerMinor: 5000 - tiny,
          lowMinor: 5000 - tiny,
          highMinor: 5000 - tiny,
        }),
      ]),
    ]);
    expect(advice.kind).toBe("leave_now");
  });

  it("picks the window that clears by the most", () => {
    const advice = adviseDeparture([
      forecast([
        point({ minutesFromNow: 0, centerMinor: 9000, lowMinor: 8800, highMinor: 9200 }),
        point({ minutesFromNow: 10, centerMinor: 8000, lowMinor: 7900, highMinor: 8100 }),
        point({ minutesFromNow: 40, centerMinor: 6000, lowMinor: 5900, highMinor: 6100 }),
      ]),
    ]);
    expect(advice.minutesFromNow).toBe(40);
  });

  it("compares a later window against the best way to leave now, not the worst", () => {
    const cheapNow = forecast([
      point({ minutesFromNow: 0, centerMinor: 4000, lowMinor: 3900, highMinor: 4100 }),
    ]);
    const dearProviderLater = forecast([
      point({ minutesFromNow: 0, centerMinor: 9000, lowMinor: 8900, highMinor: 9100 }),
      // Cheaper than that provider's own "now", and still worse than leaving
      // now on the other one.
      point({ minutesFromNow: 30, centerMinor: 6000, lowMinor: 5900, highMinor: 6100 }),
    ]);
    expect(adviseDeparture([cheapNow, dearProviderLater]).kind).toBe("leave_now");
  });

  it("never points at the past", () => {
    const advice = adviseDeparture([
      forecast([
        point({ minutesFromNow: 0, centerMinor: 9000, lowMinor: 8900, highMinor: 9100 }),
        point({ minutesFromNow: -20, centerMinor: 1000, lowMinor: 900, highMinor: 1100 }),
      ]),
    ]);
    expect(advice.kind).toBe("leave_now");
  });

  it("says so plainly when there is nothing to go on", () => {
    expect(adviseDeparture([]).kind).toBe("no_clear_window");
    expect(adviseDeparture([forecast([point({ minutesFromNow: 15 })])]).kind).toBe(
      "no_clear_window",
    );
  });

  /*
   * Whatever the advice, the sentence goes on screen unedited, so it carries
   * its own hedge.
   */
  it("hedges in the sentence itself", () => {
    const waiting = adviseDeparture([
      forecast([
        point({ minutesFromNow: 0, centerMinor: 9000, lowMinor: 8800, highMinor: 9200 }),
        point({ minutesFromNow: 40, centerMinor: 6000, lowMinor: 5900, highMinor: 6100 }),
      ]),
    ]);
    expect(waiting.sentence).toMatch(/modeled|projection/i);
    expect(waiting.sentence).not.toMatch(/\bwill\b|guarantee/i);
    expect(adviseDeparture([forecast([point({ minutesFromNow: 0 })])]).sentence).toMatch(
      /modeled/i,
    );
  });
});

describe("two uncertainties, for two different questions", () => {
  /*
   * The displayed band answers "what might this cost", and a rider gets one
   * tick, so it carries the full wander plus the model's own level error.
   * The comparison figure answers "is this window cheaper than that one",
   * where the level error is shared and cancels, and where two averages are
   * being compared rather than two samples.
   */
  it("always compares on something narrower than it displays", () => {
    for (const p of forecastProvider(input()).points) {
      const displayHalf = (p.highMinor - p.lowMinor) / 2;
      expect(p.comparisonHalfMinor).toBeLessThan(displayHalf);
    }
  });

  it("still widens the comparison with horizon", () => {
    const pts = forecastProvider(input()).points;
    expect(pts.at(-1)!.comparisonHalfMinor).toBeGreaterThan(pts[0]!.comparisonHalfMinor);
  });

  it("scales the differential term linearly, and far below the absolute one", () => {
    expect(differentialWidening(0)).toBe(0);
    expect(differentialWidening(60)).toBeCloseTo(
      MODEL_PARAMS.forecast.differentialWideningPerHour,
      6,
    );
    expect(MODEL_PARAMS.forecast.differentialWideningPerHour).toBeLessThan(
      MODEL_PARAMS.forecast.horizonWideningPerHour,
    );
  });

  /*
   * Both errors below produced correct arithmetic and a useless feature:
   * advice fired on 1 of 48 departure times, then 2. Neither would have
   * shown up as a failure.
   */
  it("never compares using the displayed band", () => {
    const pts = forecastProvider(input()).points;
    const first = pts[0]!;
    const last = pts.at(-1)!;
    const displayGate =
      (first.highMinor - first.lowMinor) / 2 + (last.highMinor - last.lowMinor) / 2;
    const comparisonGate = first.comparisonHalfMinor + last.comparisonHalfMinor;
    expect(comparisonGate).toBeLessThan(displayGate);
  });
});

describe("averaging the jitter away", () => {
  /*
   * Several ticks per point, so the hash-derived noise cancels. With one
   * sample the projected curve is that noise. The guard is that neighbouring
   * points do not swing by more than the demand curve plausibly moves in five
   * minutes.
   */
  it("produces a curve smooth enough to be structure rather than noise", () => {
    const pts = forecastProvider(input()).points;
    for (let i = 1; i < pts.length; i += 1) {
      const rel = Math.abs(pts[i]!.centerMinor - pts[i - 1]!.centerMinor) / pts[i - 1]!.centerMinor;
      expect(rel).toBeLessThan(0.2);
    }
  });

  it("averages more than one tick", () => {
    expect(MODEL_PARAMS.forecast.samplesPerPoint).toBeGreaterThan(1);
  });
});

describe("the whole window", () => {
  it("builds every provider against one clock", () => {
    const w = buildDepartureWindow([
      input({ provider: "uber", product: "uberx" }),
      input({ provider: "lyft", product: "lyft" }),
    ]);
    expect(w.forecasts).toHaveLength(2);
    expect(w.generatedAt).toBe(NOW.toISOString());
    expect(w.modelVersion).toBe(MODEL_PARAMS.version);
    // Same base clock, so the horizons line up and are comparable.
    expect(w.forecasts[0]!.points.map((p) => p.at)).toEqual(
      w.forecasts[1]!.points.map((p) => p.at),
    );
  });

  it("prices providers differently at the same instant", () => {
    const w = buildDepartureWindow([
      input({ provider: "uber", product: "uberx" }),
      input({ provider: "empower", product: "empower" }),
    ]);
    expect(w.forecasts[0]!.points[0]!.centerMinor).not.toBe(w.forecasts[1]!.points[0]!.centerMinor);
  });

  it("reaches an opinion", () => {
    const w = buildDepartureWindow([input()]);
    expect(["leave_now", "wait", "no_clear_window"]).toContain(w.advice.kind);
  });
});
