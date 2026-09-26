import { describe, expect, it } from "vitest";

import {
  MAX_WATCHES,
  MAX_WATCH_AGE_DAYS,
  PRICE_WATCH_VERSION,
  WATCH_DISCLOSURE,
  evaluateWatch,
  makeWatch,
  pruneWatches,
  removeWatch,
  suggestThresholdMinor,
  upsertWatch,
  watchForRoute,
  type PriceWatch,
} from "@/lib/history/price-watch";

const FROM = { lat: 40.7225, lng: -73.9945, label: "14 Prince St" };
const TO = { lat: 40.6446, lng: -73.7797, label: "JFK Terminal 4" };

describe("setting a watch", () => {
  it("keys itself on the route, so the same trip is one watch", () => {
    const a = makeWatch(FROM, TO, 4000);
    const b = makeWatch(FROM, TO, 3000);
    const list = upsertWatch(upsertWatch([], a), b);
    expect(list).toHaveLength(1);
    expect(list[0].thresholdMinor).toBe(3000);
  });

  it("keeps the return leg as its own watch", () => {
    const out = makeWatch(FROM, TO, 4000);
    const back = makeWatch(TO, FROM, 4000);
    expect(upsertWatch(upsertWatch([], out), back)).toHaveLength(2);
  });

  it("finds and removes by route", () => {
    const w = makeWatch(FROM, TO, 4000);
    const list = upsertWatch([], w);
    expect(watchForRoute(list, w.routeKey)?.thresholdMinor).toBe(4000);
    expect(removeWatch(list, w.routeKey)).toHaveLength(0);
    expect(watchForRoute(list, "somewhere-else")).toBeNull();
  });
});

describe("keeping the list sane", () => {
  it("drops watches older than the window", () => {
    const now = Date.UTC(2026, 8, 26);
    const stale: PriceWatch = {
      ...makeWatch(FROM, TO, 4000),
      createdAt: new Date(now - (MAX_WATCH_AGE_DAYS + 1) * 86_400_000).toISOString(),
    };
    expect(pruneWatches([stale], now)).toHaveLength(0);
  });

  it("drops a shape this build does not read", () => {
    const old = { ...makeWatch(FROM, TO, 4000), v: PRICE_WATCH_VERSION + 1 };
    expect(pruneWatches([old], Date.now())).toHaveLength(0);
  });

  it("refuses a threshold that is not a number", () => {
    const bad = { ...makeWatch(FROM, TO, Number.NaN) };
    expect(pruneWatches([bad], Date.now())).toHaveLength(0);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_WATCHES + 5 }, (_, i) => ({
      ...makeWatch(FROM, TO, 4000),
      routeKey: `route-${i}`,
    }));
    expect(pruneWatches(many, Date.now())).toHaveLength(MAX_WATCHES);
  });
});

describe("answering the standing question", () => {
  const watch = makeWatch(FROM, TO, 4000);

  /*
   * A band of $38–$46 against a $40 watch is a trip you can sometimes get
   * for less than $40. The midpoint answers a question nobody asked.
   */
  it("compares against the low of the band, not a midpoint", () => {
    const r = evaluateWatch(watch, [{ lowMinor: 3800 }])!;
    expect(r.met).toBe(true);
    expect(r.cheapestLowMinor).toBe(3800);
  });

  it("counts exactly at the threshold as met", () => {
    expect(evaluateWatch(watch, [{ lowMinor: 4000 }])!.met).toBe(true);
  });

  it("does not fire above it", () => {
    const r = evaluateWatch(watch, [{ lowMinor: 4001 }])!;
    expect(r.met).toBe(false);
    expect(r.underByMinor).toBe(0);
  });

  it("reports how far under, and never a negative", () => {
    expect(evaluateWatch(watch, [{ lowMinor: 3500 }])!.underByMinor).toBe(500);
    expect(evaluateWatch(watch, [{ lowMinor: 9999 }])!.underByMinor).toBe(0);
  });

  it("takes the cheapest of several options", () => {
    const r = evaluateWatch(watch, [{ lowMinor: 6000 }, { lowMinor: 3900 }, { lowMinor: 5000 }])!;
    expect(r.cheapestLowMinor).toBe(3900);
    expect(r.met).toBe(true);
  });

  it("has nothing to say about a comparison that priced nothing", () => {
    expect(evaluateWatch(watch, [])).toBeNull();
  });

  /* Asking is reading. Evaluating a watch must not change it. */
  it("does not change the watch by evaluating", () => {
    const before = JSON.stringify(watch);
    evaluateWatch(watch, [{ lowMinor: 1000 }]);
    evaluateWatch(watch, [{ lowMinor: 1000 }]);
    expect(JSON.stringify(watch)).toBe(before);
  });
});

describe("what a watch is allowed to claim", () => {
  /*
   * The obvious shape of this feature is a push notification and it is the
   * one thing it must not read as. There is no server polling a route and no
   * channel to send on; the disclosure has to survive somebody later writing
   * a friendlier sentence.
   */
  it("never promises to reach you", () => {
    expect(WATCH_DISCLOSURE).not.toMatch(/notify|notification|alert|push|email|text you|remind/i);
  });

  it("says when the check actually happens", () => {
    expect(WATCH_DISCLOSURE).toMatch(/when you open/i);
    expect(WATCH_DISCLOSURE).toMatch(/background/i);
  });
});

describe("suggesting a threshold", () => {
  it("offers ten per cent below, on a whole unit", () => {
    expect(suggestThresholdMinor(6995)).toBe(6200);
    expect(suggestThresholdMinor(2000)).toBe(1800);
  });

  /* "$5 off" is a rounding error on an airport run and a quarter of a hop. */
  it("scales with the fare rather than subtracting a flat amount", () => {
    const bigCut = 8000 - suggestThresholdMinor(8000);
    const smallCut = 1000 - suggestThresholdMinor(1000);
    expect(bigCut).toBeGreaterThan(smallCut);
  });

  it("never suggests nothing", () => {
    expect(suggestThresholdMinor(50)).toBeGreaterThan(0);
    expect(suggestThresholdMinor(0)).toBeGreaterThan(0);
  });

  it("suggests something the watch would not already have met", () => {
    for (const price of [500, 1234, 6995, 12000]) {
      expect(suggestThresholdMinor(price)).toBeLessThan(price);
    }
  });
});
