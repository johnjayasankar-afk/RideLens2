/**
 * The sensitivity report has to be the model's own arithmetic, not a story
 * about it.
 *
 * Every arm is asserted against an independent call to `computeProductFare`
 * with the same perturbation applied by hand. If the module ever starts
 * approximating — scaling a baseline by a factor rather than re-running the
 * engine — these fail, and that is the whole point: a plausible-looking
 * sensitivity chart built from multiplication would be indistinguishable from
 * a real one on screen.
 */

import { describe, expect, it } from "vitest";

import { buildSensitivity, type SensitivitySubject } from "@/lib/domain/sensitivity";
import { computeProductFare } from "@/lib/sources/ratecard/fare-engine";

/** Brooklyn → Midtown, a route with a real directional adjustment on it. */
const BASE = {
  pickup: { lat: 40.6782, lng: -73.9442 },
  destination: { lat: 40.758, lng: -73.9855 },
  miles: 10.8,
  osrmMinutes: 29,
};

/* A fixed clock: every figure here depends on the hour, and a test that
   depends on when it runs is a test that fails at 3am for no reason. */
const NOW = new Date("2026-09-28T19:00:00Z");

function subject(over: Partial<SensitivitySubject> = {}): SensitivitySubject {
  return {
    id: "curb",
    label: "Curb Taxi",
    provider: "curb",
    product: "taxi",
    weatherSurgeLift: 1,
    bandLowDollars: 41.55,
    bandHighDollars: 47.8,
    ...BASE,
    ...over,
  };
}

const BOARD: SensitivitySubject[] = [
  subject(),
  subject({ id: "uber", label: "UberX", provider: "uber", product: "uberx" }),
  subject({ id: "lyft", label: "Lyft", provider: "lyft", product: "lyft" }),
];

function centre(s: SensitivitySubject, now: Date = NOW): number {
  return computeProductFare({
    product: s.product,
    provider: s.provider,
    pickup: s.pickup,
    destination: s.destination,
    miles: s.miles,
    osrmMinutes: s.osrmMinutes,
    weatherSurgeLift: s.weatherSurgeLift,
    now,
  }).center;
}

describe("the report is the engine, re-run", () => {
  const report = buildSensitivity(BOARD, NOW)!;

  it("measures the cheapest option, and says which it is", () => {
    expect(report.subject).toBe("Curb Taxi");
    expect(report.baselineDollars).toBeCloseTo(centre(subject()), 2);
  });

  it("gets the traffic arms from a real run at the perturbed duration", () => {
    const lever = report.levers.find((l) => l.id === "traffic")!;
    expect(lever.up.dollars).toBeCloseTo(centre(subject({ osrmMinutes: 29 * 1.25 })), 2);
    expect(lever.down.dollars).toBeCloseTo(centre(subject({ osrmMinutes: 29 * 0.8 })), 2);
  });

  it("gets the route arms from a real run at the perturbed distance", () => {
    const lever = report.levers.find((l) => l.id === "route")!;
    expect(lever.up.dollars).toBeCloseTo(centre(subject({ miles: 10.8 * 1.1 })), 2);
    expect(lever.down.dollars).toBeCloseTo(centre(subject({ miles: 10.8 * 0.92 })), 2);
  });

  it("gets the weather arm from a real run at the wet lift", () => {
    const lever = report.levers.find((l) => l.id === "weather")!;
    expect(lever.up.dollars).toBeCloseTo(centre(subject({ weatherSurgeLift: 1.35 })), 2);
  });

  it("gets the hour arms by moving the clock, not the inputs", () => {
    const peak = new Date(NOW);
    peak.setHours(18, 30, 0, 0);
    const quiet = new Date(NOW);
    quiet.setHours(3, 30, 0, 0);
    const lever = report.levers.find((l) => l.id === "hour")!;
    expect(lever.up.dollars).toBeCloseTo(centre(subject(), peak), 2);
    expect(lever.down.dollars).toBeCloseTo(centre(subject(), quiet), 2);
  });

  it("signs every delta against the baseline", () => {
    for (const lever of report.levers) {
      expect(lever.down.deltaDollars).toBeCloseTo(lever.down.dollars - report.baselineDollars, 2);
      expect(lever.up.deltaDollars).toBeCloseTo(lever.up.dollars - report.baselineDollars, 2);
    }
  });

  it("moves the fare the way the tariff says it must", () => {
    const traffic = report.levers.find((l) => l.id === "traffic")!;
    expect(traffic.up.dollars).toBeGreaterThanOrEqual(traffic.down.dollars);
    const route = report.levers.find((l) => l.id === "route")!;
    expect(route.up.dollars).toBeGreaterThan(route.down.dollars);
  });

  /*
   * The first version of the test above asserted a strict increase and found
   * this instead: on the taxi, ±25% of drive time moves the fare by nothing
   * at all.
   *
   * That is the meter, working. A New York taxi charges $0.70 per fifth of a
   * mile above 12 mph *or* per minute at or below it — whichever the trip is
   * doing, not both. At 10.8 miles in 29 minutes it is doing 22 mph, and a
   * quarter more traffic still leaves it at 18. Distance wins either way.
   *
   * It is the single most useful thing this panel says about a cab, and it
   * only says it because the arms are real engine runs. A sensitivity chart
   * that scaled a baseline would have drawn a confident little bar here.
   */
  it("reports a genuine zero where the meter is flat, and not elsewhere", () => {
    const taxi = buildSensitivity([subject()], NOW)!;
    expect(taxi.levers.find((l) => l.id === "traffic")!.swingDollars).toBe(0);

    /* A TNC adds per-mile and per-minute together, so it cannot be flat. */
    const uber = buildSensitivity(
      [subject({ id: "uber", label: "UberX", provider: "uber", product: "uberx" })],
      NOW,
    )!;
    expect(uber.levers.find((l) => l.id === "traffic")!.swingDollars).toBeGreaterThan(1);
  });
});

describe("what it reports about the whole board", () => {
  it("orders the levers widest first", () => {
    const swings = buildSensitivity(BOARD, NOW)!.levers.map((l) => l.swingDollars);
    expect(swings).toEqual([...swings].sort((a, b) => b - a));
  });

  /*
   * The envelope is the point of the panel: the card's band assumes the
   * inputs, and this is where the fare goes when they are wrong. It can only
   * ever be at least as wide as the band.
   */
  it("reports an envelope that contains the band", () => {
    const report = buildSensitivity(BOARD, NOW)!;
    expect(report.envelopeLowDollars).toBeLessThanOrEqual(report.bandLowDollars);
    expect(report.envelopeHighDollars).toBeGreaterThanOrEqual(report.bandHighDollars);
  });

  it("runs every option under every scenario, and counts them", () => {
    const report = buildSensitivity(BOARD, NOW)!;
    expect(report.ranking.tested).toBe(8);
    expect(report.ranking.stable).toBe(report.ranking.upsets.length === 0);
  });

  /*
   * The finding a rider can act on. Constructed rather than hoped for: a board
   * whose second option is a hair more expensive and far quicker per mile will
   * change places under one of these, and when it does the panel has to say so
   * in words rather than leaving the chart to imply it.
   */
  it("names the scenarios that change who wins", () => {
    const close = [
      subject({ id: "a", label: "Alpha", provider: "curb", product: "taxi" }),
      /* Empower's card is materially cheaper per mile; at eight times the
         distance the ordering that holds at 10.8 miles does not. */
      subject({
        id: "b",
        label: "Beta",
        provider: "empower",
        product: "empower",
        miles: 10.8,
      }),
    ];
    const report = buildSensitivity(close, NOW)!;
    for (const upset of report.ranking.upsets) {
      expect(upset).toMatch(/becomes the cheapest/);
    }
    /* Whatever the outcome, the two have to agree with each other. */
    expect(report.ranking.stable).toBe(report.ranking.upsets.length === 0);
  });

  it("says so plainly when nothing moves it", () => {
    const report = buildSensitivity(BOARD, NOW)!;
    expect(report.headline.length).toBeGreaterThan(20);
    expect(report.headline).not.toContain("undefined");
    expect(report.headline).not.toContain("NaN");
  });

  it("has nothing to report with nothing to run", () => {
    expect(buildSensitivity([], NOW)).toBeNull();
  });

  /* Same inputs, same clock, same answer — or none of the above means anything. */
  it("is deterministic", () => {
    const a = buildSensitivity(BOARD, NOW)!;
    const b = buildSensitivity(BOARD, NOW)!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("whether the band already covers it", () => {
  /*
   * The verdict a rider can act on, and the one that only exists because the
   * arms are real: on a fast taxi trip every scenario lands inside the band
   * the card already prints, and saying so is more useful than a chart.
   */
  it("reports when nothing escaped the band", () => {
    const wide = buildSensitivity([subject({ bandLowDollars: 1, bandHighDollars: 500 })], NOW)!;
    expect(wide.insideBand).toBe(true);
    expect(wide.headline).toContain("already covers");
    expect(wide.envelopeLowDollars).toBe(1);
    expect(wide.envelopeHighDollars).toBe(500);
  });

  it("reports when something escaped it", () => {
    const narrow = buildSensitivity(
      [
        subject({
          id: "uber",
          label: "UberX",
          provider: "uber",
          product: "uberx",
          bandLowDollars: 50,
          bandHighDollars: 50.5,
        }),
      ],
      NOW,
    )!;
    expect(narrow.insideBand).toBe(false);
    expect(narrow.headline).toContain("further than the band");
  });

  /* The envelope must never be narrower than the band it contains. */
  it("keeps the envelope around both", () => {
    for (const band of [
      { bandLowDollars: 1, bandHighDollars: 500 },
      { bandLowDollars: 41.55, bandHighDollars: 47.8 },
      { bandLowDollars: 50, bandHighDollars: 50.5 },
    ]) {
      /* The band travels with the subject, so every option carries it and
         whichever wins brings the right one. */
      const r = buildSensitivity(
        BOARD.map((s) => ({ ...s, ...band })),
        NOW,
      )!;
      expect(r.envelopeLowDollars).toBeLessThanOrEqual(band.bandLowDollars);
      expect(r.envelopeHighDollars).toBeGreaterThanOrEqual(band.bandHighDollars);
      if (r.insideBand) {
        expect(r.envelopeLowDollars).toBeCloseTo(band.bandLowDollars, 2);
        expect(r.envelopeHighDollars).toBeCloseTo(band.bandHighDollars, 2);
      }
    }
  });
});

describe("the baseline and the band belong to each other", () => {
  /*
   * The bug this catches, which shipped for about ten minutes and was visible
   * on screen: the report was built at request time while the band came from
   * the card, priced up to a minute earlier. The marketplace ticks roughly
   * every 55 seconds and carries a few per cent of micro-volatility, so the
   * baseline landed outside its own band and the strip drawn down the middle
   * of the chart sat entirely to one side of the centre line.
   */
  const PRICED_AT = new Date("2026-09-28T19:42:17.000Z");

  function fromEngine(provider: "curb" | "uber", product: "taxi" | "uberx") {
    const fare = computeProductFare({
      product,
      provider,
      ...BASE,
      weatherSurgeLift: 1,
      now: PRICED_AT,
    });
    return {
      fare,
      subject: subject({
        id: provider,
        label: provider,
        provider,
        product,
        bandLowDollars: fare.low,
        bandHighDollars: fare.high,
      }),
    };
  }

  it("reproduces the card's own centre when priced at the card's clock", () => {
    const { fare, subject: s } = fromEngine("curb", "taxi");
    const report = buildSensitivity([s], PRICED_AT)!;
    expect(report.baselineDollars).toBeCloseTo(fare.center, 2);
  });

  it("puts the baseline inside the band it draws", () => {
    for (const [provider, product] of [
      ["curb", "taxi"],
      ["uber", "uberx"],
    ] as const) {
      const { subject: s } = fromEngine(provider, product);
      const report = buildSensitivity([s], PRICED_AT)!;
      expect(report.baselineDollars, provider).toBeGreaterThanOrEqual(report.bandLowDollars);
      expect(report.baselineDollars, provider).toBeLessThanOrEqual(report.bandHighDollars);
    }
  });

  /* And takes the band of whichever option it ended up measuring. */
  it("uses the winner's band, not the first one it was handed", () => {
    const cheap = fromEngine("curb", "taxi");
    const dear = fromEngine("uber", "uberx");
    const report = buildSensitivity([dear.subject, cheap.subject], PRICED_AT)!;
    expect(report.subject).toBe("curb");
    expect(report.bandLowDollars).toBeCloseTo(cheap.fare.low, 2);
    expect(report.bandHighDollars).toBeCloseTo(cheap.fare.high, 2);
  });
});
