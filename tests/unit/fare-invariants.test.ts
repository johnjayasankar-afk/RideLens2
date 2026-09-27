/**
 * What must be true of every fare the model produces.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The corpus is empty, and will stay empty until riders report what they   │
 * │ actually paid. Until then nothing can say whether a number is *right*.   │
 * │ But plenty can say whether it is *coherent*, and a model that contra-    │
 * │ dicts itself is wrong without needing ground truth to prove it.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So this is not calibration and does not pretend to be. It is a fuzzer over
 * the fare engine asserting the properties the rest of the product already
 * relies on: that a band contains its own centre, that a longer trip never
 * costs less, that the same inputs give the same answer, that a multiplier
 * stays inside the range its own comment claims.
 *
 * Each case is drawn from a seeded generator, so a failure reproduces exactly
 * and CI cannot be flaky. `SAMPLES` is the knob; raising it is the cheapest
 * way to look harder.
 */

import { describe, expect, it } from "vitest";

import { computeProductFare, type FareProduct } from "@/lib/sources/ratecard/fare-engine";
import {
  computeMarketplaceState,
  microVolatility,
} from "@/lib/sources/ratecard/marketplace-dynamics";

/** Enough to explore the space; small enough to stay off the critical path. */
const SAMPLES = 1500;

type Provider = "uber" | "lyft" | "empower" | "curb";

const PRODUCTS: Array<{ product: FareProduct; provider: Provider }> = [
  { product: "uberx", provider: "uber" },
  { product: "comfort", provider: "uber" },
  { product: "uberxl", provider: "uber" },
  { product: "lyft", provider: "lyft" },
  { product: "lyft_xl", provider: "lyft" },
  { product: "taxi", provider: "curb" },
  { product: "empower", provider: "empower" },
];

/* mulberry32: small, seeded, and good enough to explore a parameter space. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Case {
  product: FareProduct;
  provider: Provider;
  pickup: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  miles: number;
  osrmMinutes: number;
  now: Date;
  weatherSurgeLift: number;
}

/**
 * Coordinates span the NYC box and a good way outside it, so the market
 * lookup, the congestion zones and the out-of-market path all get exercised
 * rather than only the happy corridor the fixtures use.
 */
function makeCase(r: () => number): Case {
  const pick = PRODUCTS[Math.floor(r() * PRODUCTS.length)];
  const lat = 40.4 + r() * 1.2;
  const lng = -74.4 + r() * 1.4;
  return {
    product: pick.product,
    provider: pick.provider,
    pickup: { lat, lng },
    destination: { lat: lat + (r() - 0.5) * 0.6, lng: lng + (r() - 0.5) * 0.6 },
    miles: 0.2 + r() * 59.8,
    osrmMinutes: 1 + r() * 179,
    /* A full year, so every hour, weekday and season is reachable. */
    now: new Date(Date.UTC(2026, 0, 1) + Math.floor(r() * 365 * 86_400_000)),
    weatherSurgeLift: 1 + r() * 1.5,
  };
}

const cases = (() => {
  const r = rng(20260926);
  return Array.from({ length: SAMPLES }, () => makeCase(r));
})();

function describeCase(c: Case): string {
  return `${c.provider}/${c.product} ${c.miles.toFixed(2)}mi ${c.osrmMinutes.toFixed(1)}min @ ${c.now.toISOString()} wx=${c.weatherSurgeLift.toFixed(2)} from ${c.pickup.lat.toFixed(4)},${c.pickup.lng.toFixed(4)}`;
}

describe("every fare the engine can produce", () => {
  it("is a finite number, never NaN and never negative", () => {
    for (const c of cases) {
      const f = computeProductFare(c);
      for (const [key, value] of Object.entries({
        center: f.center,
        low: f.low,
        high: f.high,
        band: f.band,
        rateCard: f.rateCardDollars,
        fees: f.feesDollars,
        trafficMinutes: f.trafficMinutes,
      })) {
        expect(Number.isFinite(value), `${key} not finite — ${describeCase(c)}`).toBe(true);
      }
      expect(f.center, `negative centre — ${describeCase(c)}`).toBeGreaterThan(0);
      expect(f.low, `negative low — ${describeCase(c)}`).toBeGreaterThan(0);
      expect(f.trafficMinutes, `negative duration — ${describeCase(c)}`).toBeGreaterThan(0);
    }
  });

  /*
   * The UI draws a band and never a midpoint, and `comparePrices` decides
   * overlap from the edges. A band that does not contain its own centre
   * would make both of those quietly wrong.
   */
  it("contains its own centre", () => {
    for (const c of cases) {
      const f = computeProductFare(c);
      expect(f.low, `low above centre — ${describeCase(c)}`).toBeLessThanOrEqual(f.center);
      expect(f.high, `high below centre — ${describeCase(c)}`).toBeGreaterThanOrEqual(f.center);
      expect(f.band, `non-positive band — ${describeCase(c)}`).toBeGreaterThan(0);
    }
  });

  /*
   * The whole product is a number that moves on a clock. If it also moved
   * when nothing had, every freshness label and every "prices reshape in
   * 17s" would be describing noise.
   */
  it("gives the same answer to the same question", () => {
    for (const c of cases.slice(0, 400)) {
      const a = computeProductFare(c);
      const b = computeProductFare({ ...c, now: new Date(c.now.getTime()) });
      expect(b, `not deterministic — ${describeCase(c)}`).toEqual(a);
    }
  });
});

describe("the shape of the fare surface", () => {
  /*
   * Distance is the one input a rider can reason about. If a longer trip
   * could come back cheaper, every comparison on the page is untrustworthy
   * in a way no disclosure could cover.
   */
  it("never charges less for a longer trip", () => {
    const r = rng(7);
    for (let i = 0; i < 400; i++) {
      const base = makeCase(r);
      const shorter = { ...base, miles: 2 };
      const longer = { ...base, miles: 20 };
      const a = computeProductFare(shorter);
      const b = computeProductFare(longer);
      expect(
        b.center,
        `20mi cheaper than 2mi — ${describeCase(base)}: ${a.center} vs ${b.center}`,
      ).toBeGreaterThanOrEqual(a.center);
    }
  });

  /* Time is metered too, and the same argument applies to it. */
  it("never charges less for a slower trip over the same distance", () => {
    const r = rng(11);
    for (let i = 0; i < 400; i++) {
      const base = makeCase(r);
      const quick = computeProductFare({ ...base, osrmMinutes: 10 });
      const slow = computeProductFare({ ...base, osrmMinutes: 60 });
      expect(
        slow.center,
        `60min cheaper than 10min — ${describeCase(base)}`,
      ).toBeGreaterThanOrEqual(quick.center);
    }
  });

  /*
   * Rain raises prices or leaves them alone. It has never lowered one, and
   * a model that let it would be producing a signal backwards.
   */
  it("never lowers a fare because the weather got worse", () => {
    const r = rng(13);
    for (let i = 0; i < 400; i++) {
      const base = makeCase(r);
      const dry = computeProductFare({ ...base, weatherSurgeLift: 1 });
      const wet = computeProductFare({ ...base, weatherSurgeLift: 2 });
      expect(wet.center, `rain made it cheaper — ${describeCase(base)}`).toBeGreaterThanOrEqual(
        dry.center,
      );
    }
  });
});

describe("the marketplace multiplier", () => {
  /*
   * The clamps are written down in marketplace-dynamics.ts. A test that
   * reads them back is how they stay true when somebody edits the formula
   * above them rather than the clamp itself.
   */
  it("stays inside the range its own code claims", () => {
    for (const c of cases) {
      const s = computeMarketplaceState(c);
      expect(Number.isFinite(s.multiplier), `multiplier not finite — ${describeCase(c)}`).toBe(
        true,
      );

      const ceiling =
        c.provider === "empower"
          ? 1.45
          : c.provider === "curb" || c.product === "taxi"
            ? 1.12
            : 1.85;
      const floor = c.provider === "curb" || c.product === "taxi" ? 0.98 : 0.92;

      expect(s.multiplier, `below floor — ${describeCase(c)}`).toBeGreaterThanOrEqual(floor);
      expect(s.multiplier, `above ceiling — ${describeCase(c)}`).toBeLessThanOrEqual(ceiling);
    }
  });

  /* The countdown on screen is read off this. It cannot be zero or negative. */
  it("always has a tick still to come", () => {
    for (const c of cases) {
      const s = computeMarketplaceState(c);
      expect(s.secondsToNextTick, `tick <= 0 — ${describeCase(c)}`).toBeGreaterThan(0);
      expect(s.secondsToNextTick, `tick > 55s — ${describeCase(c)}`).toBeLessThanOrEqual(55);
      expect(Number.isInteger(s.tickEpoch)).toBe(true);
    }
  });

  /*
   * The noise is the thing the tick is about, and it must not move by so
   * much as a floating-point bit inside one.
   *
   * This is the assertion that caught the real bug: `microVolatility`
   * seeded its jump from the tick but its drift from the raw clock, so the
   * sine completed a whole cycle inside every tick.
   */
  it("resamples its noise once per tick and not once per millisecond", () => {
    const r = rng(17);
    for (let i = 0; i < 300; i++) {
      const c = makeCase(r);
      /* Start at a tick boundary, so every offset below is the same tick. */
      const boundary = Math.floor(c.now.getTime() / 55_000) * 55_000;
      const at = (ms: number) => microVolatility({ ...c, now: new Date(boundary + ms) });

      const first = at(0);
      for (const offset of [1, 999, 10_000, 30_000, 54_999]) {
        const later = at(offset);
        expect(later.tick, `tick changed at +${offset}ms — ${describeCase(c)}`).toBe(first.tick);
        expect(
          later.jitter,
          `noise moved at +${offset}ms inside one tick — ${describeCase(c)}`,
        ).toBe(first.jitter);
      }

      /* And it does move across the boundary, or the tick means nothing. */
      expect(at(55_000).tick).toBe(first.tick + 1);
    }
  });

  /*
   * The multiplier as a whole may drift a hair inside a tick, because the
   * demand curve underneath it is a smooth function of the clock rather
   * than noise — 55 seconds along a Gaussian measured in hours. That is a
   * model of demand, not a resample, and it is allowed to be continuous.
   * What it is not allowed to do is move enough for anyone to notice,
   * because the countdown says prices reshape *then*, not now.
   */
  it("does not visibly move inside a tick", () => {
    const r = rng(19);
    for (let i = 0; i < 300; i++) {
      const c = makeCase(r);
      const boundary = Math.floor(c.now.getTime() / 55_000) * 55_000;
      const a = computeMarketplaceState({ ...c, now: new Date(boundary) });
      const b = computeMarketplaceState({ ...c, now: new Date(boundary + 54_000) });

      expect(b.tickEpoch).toBe(a.tickEpoch);
      const driftPct = Math.abs(b.multiplier - a.multiplier) / a.multiplier;
      expect(
        driftPct,
        `multiplier drifted ${(driftPct * 100).toFixed(2)}% inside a tick — ${describeCase(c)}`,
      ).toBeLessThan(0.005);
    }
  });

  /* Every factor shown in the breakdown has to be a number a reader could check. */
  it("reports only finite factors", () => {
    for (const c of cases.slice(0, 500)) {
      const s = computeMarketplaceState(c);
      for (const [name, value] of Object.entries(s.factors)) {
        expect(Number.isFinite(value), `factor ${name} not finite — ${describeCase(c)}`).toBe(true);
      }
    }
  });
});
