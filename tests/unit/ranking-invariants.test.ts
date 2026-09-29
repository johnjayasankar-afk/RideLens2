/**
 * What must be true of every comparison and every ranking.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `comparePrices` is the function every claim on the page is routed        │
 * │ through — it is what refuses to name a winner when two bands overlap.    │
 * │ It is also handed straight to `Array.prototype.sort` as a comparator,    │
 * │ and a comparator that contradicts itself produces an order that depends  │
 * │ on the engine's sort implementation. "Best price" would be whichever     │
 * │ row V8 happened to leave first.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The examples in `why-this-one.test.ts` and `reconciler.test.ts` check the
 * cases somebody thought of. This checks the ones nobody did: a few thousand
 * random bands, asserting the properties the comparator has to have for the
 * sort above it to mean anything.
 */

import { describe, expect, it } from "vitest";

import { comparePrices, filterByCategories, rankQuotes } from "@/lib/domain/ranking";
import type { NormalizedQuote, RankingMode, RideCategory } from "@/lib/domain/types";

const SAMPLES = 2000;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES: RideCategory[] = ["STANDARD", "XL", "PREMIUM", "TAXI"];

let seq = 0;
function quote(r: () => number, over: Partial<NormalizedQuote> = {}): NormalizedQuote {
  seq += 1;
  /* Bands from exact points to very wide, so every branch is reachable. */
  const min = 500 + Math.floor(r() * 9500);
  const width = r() < 0.25 ? 0 : Math.floor(r() * 4000);
  const max = min + width;
  const type = width === 0 ? (r() < 0.5 ? "UPFRONT_QUOTE" : "ESTIMATE") : "ESTIMATE_RANGE";
  const confidence =
    type === "UPFRONT_QUOTE" ? "HIGH" : width < 600 ? "MEDIUM" : width < 2000 ? "LOW" : "UNCERTAIN";
  return {
    id: `q${seq}`,
    provider: (["uber", "lyft", "empower", "curb"] as const)[Math.floor(r() * 4)],
    providerProductId: `p${seq}`,
    providerProductName: `Product ${seq}`,
    normalizedCategory: CATEGORIES[Math.floor(r() * CATEGORIES.length)],
    priceType: type,
    priceMinMinor: min,
    priceMaxMinor: max,
    displayPriceMinor: min,
    rankingPriceMinor: Math.round((min + max) / 2),
    currency: "USD",
    pickupEtaSeconds: r() < 0.1 ? null : Math.floor(r() * 1800),
    tripDurationSeconds: Math.floor(600 + r() * 3600),
    distanceMeters: Math.floor(500 + r() * 40000),
    availability: "AVAILABLE",
    source: "public_rate_card",
    sourceMethod: "public_rate_card",
    accountContext: "PUBLIC",
    receivedAt: new Date().toISOString(),
    providerTimestamp: null,
    expiresAt: null,
    freshness: "LIVE",
    bookingHandoff: null,
    confidenceClass: confidence,
    metadata: {},
    ...over,
  };
}

function band(q: NormalizedQuote): string {
  return `[${q.priceMinMinor}, ${q.priceMaxMinor}] ${q.priceType}/${q.confidenceClass}`;
}

describe("comparing two prices", () => {
  const r = rng(424242);
  const pairs = Array.from({ length: SAMPLES }, () => [quote(r), quote(r)] as const);

  /*
   * If A is cheaper than B, B has to be more expensive than A. A comparator
   * that can say "cheaper" both ways round sorts into whatever order the
   * engine's merge happens to produce.
   */
  it("says the same thing whichever way round it is asked", () => {
    for (const [a, b] of pairs) {
      const ab = comparePrices(a, b).relation;
      const ba = comparePrices(b, a).relation;
      const mirror = { cheaper: "more_expensive", more_expensive: "cheaper" } as const;
      const expected = mirror[ab as keyof typeof mirror] ?? ab;
      expect(ba, `asymmetric: ${band(a)} vs ${band(b)} gave ${ab} / ${ba}`).toBe(expected);
    }
  });

  /* A saving is an amount, and an amount below zero is a different claim. */
  it("never reports a negative saving", () => {
    for (const [a, b] of pairs) {
      for (const cmp of [comparePrices(a, b), comparePrices(b, a)]) {
        if (cmp.savingsMinor !== undefined) {
          expect(cmp.savingsMinor, `${band(a)} vs ${band(b)}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("calls a price similar to itself", () => {
    for (const [a] of pairs) {
      const cmp = comparePrices(a, a);
      expect(cmp.relation, band(a)).toBe("similar");
      expect(cmp.savingsMinor ?? 0).toBe(0);
    }
  });

  /*
   * The rule the whole product rests on. Two overlapping bands do not
   * establish which is cheaper, and the only exception is two exact prices
   * with nothing uncertain about either.
   */
  it("refuses to name a winner when the bands overlap", () => {
    for (const [a, b] of pairs) {
      const overlapping = a.priceMinMinor <= b.priceMaxMinor && b.priceMinMinor <= a.priceMaxMinor;
      if (!overlapping) continue;

      const bothExactAndCertain =
        a.confidenceClass === "HIGH" &&
        b.confidenceClass === "HIGH" &&
        a.priceMinMinor === a.priceMaxMinor &&
        b.priceMinMinor === b.priceMaxMinor;
      if (bothExactAndCertain) continue;

      const relation = comparePrices(a, b).relation;
      expect(
        relation === "cheaper" || relation === "more_expensive",
        `asserted "${relation}" on overlapping bands: ${band(a)} vs ${band(b)}`,
      ).toBe(false);
    }
  });

  /* Touching at a single cent is overlapping, not separated. */
  it("treats bands that touch as overlapping", () => {
    const a = quote(rng(1), {
      priceMinMinor: 2000,
      priceMaxMinor: 3000,
      priceType: "ESTIMATE_RANGE",
      confidenceClass: "LOW",
      rankingPriceMinor: 2500,
    });
    const b = quote(rng(2), {
      priceMinMinor: 3000,
      priceMaxMinor: 4000,
      priceType: "ESTIMATE_RANGE",
      confidenceClass: "LOW",
      rankingPriceMinor: 3500,
    });
    expect(comparePrices(a, b).relation).not.toBe("cheaper");
  });
});

describe("ranking a list", () => {
  const r = rng(99);
  const lists = Array.from({ length: 300 }, () =>
    Array.from({ length: 2 + Math.floor(r() * 8) }, () => quote(r)),
  );
  const MODES: RankingMode[] = ["cheapest", "fastest", "best_value"];

  it("returns the quotes it was given and no others", () => {
    for (const list of lists) {
      for (const mode of MODES) {
        const ranked = rankQuotes(list, mode, "ALL");
        const ids = new Set(ranked.map((q) => q.id));
        expect(ids.size, "a quote appears twice").toBe(ranked.length);
        for (const q of ranked) {
          expect(
            list.some((o) => o.id === q.id),
            `invented ${q.id}`,
          ).toBe(true);
        }
      }
    }
  });

  it("does not mutate the list it was handed", () => {
    for (const list of lists.slice(0, 100)) {
      const before = list.map((q) => q.id).join(",");
      rankQuotes(list, "cheapest", "ALL");
      expect(list.map((q) => q.id).join(",")).toBe(before);
    }
  });

  it("gives the same order twice", () => {
    for (const list of lists) {
      for (const mode of MODES) {
        const a = rankQuotes(list, mode, "ALL").map((q) => q.id);
        const b = rankQuotes(list, mode, "ALL").map((q) => q.id);
        expect(b).toEqual(a);
      }
    }
  });

  /*
   * The one that matters. `comparePrices` is the comparator, so if the order
   * it produces can contain a pair where the later row is outright cheaper
   * than the earlier one, then "Best price" is naming the wrong row — and
   * the reason would be a comparator that contradicts itself rather than
   * anything visible in the output.
   */
  it("never leaves a cheaper quote below a dearer one", () => {
    for (const list of lists) {
      const ranked = rankQuotes(list, "cheapest", "ALL");
      for (let i = 0; i < ranked.length; i++) {
        for (let j = i + 1; j < ranked.length; j++) {
          const later = comparePrices(ranked[j], ranked[i]).relation;
          expect(
            later,
            `${ranked[j].id} ${band(ranked[j])} ranked below ${ranked[i].id} ${band(ranked[i])} but is outright cheaper`,
          ).not.toBe("cheaper");
        }
      }
    }
  });

  it("puts the soonest first when asked for soonest", () => {
    for (const list of lists) {
      const ranked = rankQuotes(list, "fastest", "ALL");
      for (let i = 1; i < ranked.length; i++) {
        const prev = ranked[i - 1].pickupEtaSeconds ?? Number.POSITIVE_INFINITY;
        const curr = ranked[i].pickupEtaSeconds ?? Number.POSITIVE_INFINITY;
        expect(prev, "a later row has a sooner pickup").toBeLessThanOrEqual(curr);
      }
    }
  });
});

describe("filtering", () => {
  const r = rng(555);
  const lists = Array.from({ length: 200 }, () =>
    Array.from({ length: 1 + Math.floor(r() * 9) }, () => quote(r)),
  );

  it("only ever removes", () => {
    for (const list of lists) {
      for (const filter of ["ALL", "standard", ["XL"], ["PREMIUM", "TAXI"]] as const) {
        const out = filterByCategories(list, filter as RideCategory[] | "ALL" | "standard");
        expect(out.length).toBeLessThanOrEqual(list.length);
        for (const q of out) {
          expect(
            list.some((o) => o.id === q.id),
            `invented ${q.id}`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps everything when asked for everything", () => {
    for (const list of lists) {
      expect(filterByCategories(list, "ALL")).toHaveLength(list.length);
    }
  });

  it("returns only the categories asked for", () => {
    for (const list of lists) {
      for (const want of [["XL"], ["PREMIUM"], ["TAXI"], ["STANDARD"]] as RideCategory[][]) {
        for (const q of filterByCategories(list, want)) {
          expect(want).toContain(q.normalizedCategory);
        }
      }
    }
  });
});

/**
 * The figure, and when there may not be one.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ QUOTE_SEMANTICS.md draws one line twice. ":23 Never show a fabricated   │
 * │ midpoint to users. Midpoint/p50 is ranking-only." And ":40 If ranges     │
 * │ overlap significantly, relation is `similar` or `unclear` ('Likely      │
 * │ cheaper'), never a false precise '$X cheaper' claim from a midpoint     │
 * │ alone" — with ":42 Non-overlapping ranges may assert cheaper/more       │
 * │ expensive using the gap between bounds."                                 │
 * │                                                                          │
 * │ `comparePrices` returned `savingsMinor` on its `unclear` branch anyway,  │
 * │ computed as one ranking midpoint minus the other, and every reader of    │
 * │ that field was a violation waiting to be written. Two had been: the      │
 * │ Takeaway banner's "Likely save ~$X" and why-this-one's "for $X less".   │
 * │                                                                          │
 * │ So the rule is asserted on the object rather than on the six places      │
 * │ that render it. A figure that is not there cannot be printed.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
describe("a money figure is only ever the gap between bounds", () => {
  it("never offers a saving across bands that overlap", () => {
    const r = rng(90210);
    for (let i = 0; i < SAMPLES; i += 1) {
      const a = quote(r);
      const b = quote(r);
      const cmp = comparePrices(a, b);
      const overlapping = a.priceMaxMinor >= b.priceMinMinor && b.priceMaxMinor >= a.priceMinMinor;
      if (!overlapping) continue;
      /*
       * Two exact prices that happen to differ are not an overlap in the
       * sense :40 means — both bands are a single point, and :42's gap
       * between bounds is simply their difference.
       */
      const bothExact = a.priceMinMinor === a.priceMaxMinor && b.priceMinMinor === b.priceMaxMinor;
      if (bothExact && a.confidenceClass === "HIGH" && b.confidenceClass === "HIGH") continue;
      expect(
        cmp.savingsMinor ?? 0,
        `${a.priceMinMinor}-${a.priceMaxMinor} vs ${b.priceMinMinor}-${b.priceMaxMinor}`,
      ).toBe(0);
    }
  });

  it("gives no figure at all on an unclear relation", () => {
    const r = rng(1337);
    for (let i = 0; i < SAMPLES; i += 1) {
      const cmp = comparePrices(quote(r), quote(r));
      if (cmp.relation === "unclear") expect(cmp.savingsMinor).toBeUndefined();
    }
  });

  it("computes a stated saving from the bounds, never from the midpoints", () => {
    const r = rng(4242);
    for (let i = 0; i < SAMPLES; i += 1) {
      const a = quote(r);
      const b = quote(r);
      const cmp = comparePrices(a, b);
      if (cmp.relation === "cheaper" && a.priceMaxMinor < b.priceMinMinor) {
        expect(cmp.savingsMinor).toBe(b.priceMinMinor - a.priceMaxMinor);
      }
      if (cmp.relation === "more_expensive" && b.priceMaxMinor < a.priceMinMinor) {
        expect(cmp.savingsMinor).toBe(a.priceMinMinor - b.priceMaxMinor);
      }
    }
  });
});
