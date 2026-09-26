import { describe, expect, it } from "vitest";

import { clearlyCheapest, explainWinner } from "@/lib/domain/why-this-one";
import type { NormalizedQuote } from "@/lib/domain/types";

let seq = 0;
function quote(over: Partial<NormalizedQuote> = {}): NormalizedQuote {
  seq += 1;
  const min = over.priceMinMinor ?? 2500;
  const max = over.priceMaxMinor ?? min;
  return {
    id: `q${seq}`,
    provider: "uber",
    providerProductId: "uberx",
    providerProductName: "UberX",
    normalizedCategory: "STANDARD",
    priceType: "ESTIMATE_RANGE",
    priceMinMinor: min,
    priceMaxMinor: max,
    displayPriceMinor: min,
    rankingPriceMinor: Math.round((min + max) / 2),
    currency: "USD",
    pickupEtaSeconds: 300,
    tripDurationSeconds: 1800,
    distanceMeters: 8000,
    availability: "AVAILABLE",
    source: "public_rate_card",
    sourceMethod: "public_rate_card",
    accountContext: "PUBLIC",
    receivedAt: new Date().toISOString(),
    providerTimestamp: null,
    expiresAt: null,
    freshness: "LIVE",
    bookingHandoff: null,
    confidenceClass: "MEDIUM",
    metadata: {},
    ...over,
  };
}

describe("finding the cheapest at all", () => {
  it("names a row that beats every other outright", () => {
    const cheap = quote({ priceMinMinor: 2000, priceMaxMinor: 2100 });
    const dear = quote({ priceMinMinor: 3000, priceMaxMinor: 3100 });
    expect(clearlyCheapest([dear, cheap])).toBe(cheap);
  });

  /*
   * The point of routing this through comparePrices rather than comparing
   * midpoints: two overlapping ranges have no cheaper one, and saying they do
   * is the exact claim the comparison refuses to make.
   */
  it("refuses to name one when the ranges overlap", () => {
    expect(
      clearlyCheapest([
        quote({ priceMinMinor: 2000, priceMaxMinor: 3000 }),
        quote({ priceMinMinor: 2400, priceMaxMinor: 3400 }),
      ]),
    ).toBeNull();
  });

  it("refuses when the leader beats one row but not another", () => {
    expect(
      clearlyCheapest([
        quote({ priceMinMinor: 2000, priceMaxMinor: 2100 }),
        quote({ priceMinMinor: 2050, priceMaxMinor: 2200 }),
        quote({ priceMinMinor: 5000, priceMaxMinor: 5100 }),
      ]),
    ).toBeNull();
  });

  it("handles an empty board", () => {
    expect(clearlyCheapest([])).toBeNull();
  });
});

describe("when the top row is not the cheapest", () => {
  it("says the cheapest is further out, sorted by arrival", () => {
    const hero = quote({
      providerProductName: "UberX",
      priceMinMinor: 3000,
      pickupEtaSeconds: 120,
    });
    const cheaper = quote({
      providerProductName: "Lyft",
      priceMinMinor: 2000,
      pickupEtaSeconds: 960,
    });
    const note = explainWinner([hero, cheaper], "fastest")!;
    expect(note.reason).toBe("not_cheapest");
    expect(note.sentence).toMatch(/arrives soonest/i);
    expect(note.sentence).toMatch(/Lyft is 14 min further out/);
    expect(note.sentence).toMatch(/\$10\.00 less/);
  });

  it("names the gap in any other mode", () => {
    const hero = quote({
      providerProductName: "UberX",
      priceMinMinor: 3000,
      pickupEtaSeconds: 300,
    });
    const cheaper = quote({
      providerProductName: "Lyft",
      priceMinMinor: 2000,
      pickupEtaSeconds: 300,
    });
    const note = explainWinner([hero, cheaper], "best_value")!;
    expect(note.sentence).toMatch(/Not the cheapest/);
    expect(note.sentence).toMatch(/at least \$10\.00 less/);
  });

  /* "At least", never "exactly": the figure is a clearance, not a midpoint gap. */
  it("hedges the saving rather than stating it flat", () => {
    const note = explainWinner(
      [
        quote({ providerProductName: "UberX", priceMinMinor: 3000, priceMaxMinor: 3400 }),
        quote({ providerProductName: "Lyft", priceMinMinor: 2000, priceMaxMinor: 2200 }),
      ],
      "best_value",
    )!;
    expect(note.sentence).toMatch(/at least/);
  });
});

describe("when nothing separates the top two", () => {
  /*
   * The case a plain sorted list gets most wrong. Something has to be first,
   * and a rider reading a ranking assumes being first meant something.
   */
  it("says the ranges overlap rather than implying a win", () => {
    const note = explainWinner(
      [
        quote({ providerProductName: "UberX", priceMinMinor: 2000, priceMaxMinor: 3000 }),
        quote({ providerProductName: "Lyft", priceMinMinor: 2100, priceMaxMinor: 3100 }),
      ],
      "cheapest",
    )!;
    expect(note.reason).toBe("too_close_to_call");
    expect(note.sentence).toMatch(/same price/i);
    expect(note.sentence).toMatch(/Lyft/);
  });
});

describe("when it won on the least certain number", () => {
  it("says the band is doing the work", () => {
    const note = explainWinner(
      [
        quote({ priceMinMinor: 1000, priceMaxMinor: 2000, confidenceClass: "UNCERTAIN" }),
        quote({ priceMinMinor: 4000, priceMaxMinor: 4100 }),
      ],
      "cheapest",
    )!;
    expect(note.reason).toBe("wide_band");
    expect(note.sentence).toMatch(/widest range/i);
    expect(note.sentence).toMatch(/\$10\.00/);
  });
});

describe("staying quiet", () => {
  /* A note on every card is a note nobody reads. */
  it("says nothing when the top row is plainly and confidently cheapest", () => {
    expect(
      explainWinner(
        [
          quote({ priceMinMinor: 2000, priceMaxMinor: 2100, confidenceClass: "MEDIUM" }),
          quote({ priceMinMinor: 4000, priceMaxMinor: 4100 }),
        ],
        "cheapest",
      ),
    ).toBeNull();
  });

  it("says nothing with fewer than two rows to compare", () => {
    expect(explainWinner([], "cheapest")).toBeNull();
    expect(explainWinner([quote()], "cheapest")).toBeNull();
  });
});
