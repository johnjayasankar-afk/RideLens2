import { describe, expect, it } from "vitest";

import { buildPriceAxis } from "@/lib/domain/price-axis";
import type { NormalizedQuote } from "@/lib/domain/types";

let seq = 0;
function quote(min: number, max: number, name = "UberX"): NormalizedQuote {
  seq += 1;
  return {
    id: `q${seq}`,
    provider: "uber",
    providerProductId: "uberx",
    providerProductName: name,
    normalizedCategory: "STANDARD",
    priceType: "ESTIMATE_RANGE",
    priceMinMinor: min,
    priceMaxMinor: max,
    displayPriceMinor: min,
    rankingPriceMinor: Math.round((min + max) / 2),
    currency: "USD",
    pickupEtaSeconds: 180,
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
  };
}

describe("one shared ruler", () => {
  /*
   * The point of a common scale. Drawn to their own widths, a tight certain
   * quote and a vague one look identical; here a wide band is wide.
   */
  it("spans from the lowest floor to the highest ceiling", () => {
    const axis = buildPriceAxis([quote(2000, 2100), quote(5000, 9000)])!;
    expect(axis.lowMinor).toBe(2000);
    expect(axis.highMinor).toBe(9000);
    expect(axis.bars[0]!.startFraction).toBe(0);
    expect(axis.bars[1]!.endFraction).toBe(1);
  });

  it("draws a wide band wider than a tight one", () => {
    const axis = buildPriceAxis([quote(2000, 2100), quote(3000, 8000)])!;
    const width = (i: number) => axis.bars[i]!.endFraction - axis.bars[i]!.startFraction;
    expect(width(1)).toBeGreaterThan(width(0) * 5);
  });

  it("keeps every fraction on the ruler", () => {
    const axis = buildPriceAxis([quote(1000, 2000), quote(1500, 9000), quote(2200, 2300)])!;
    for (const bar of axis.bars) {
      expect(bar.startFraction).toBeGreaterThanOrEqual(0);
      expect(bar.endFraction).toBeLessThanOrEqual(1);
      expect(bar.startFraction).toBeLessThanOrEqual(bar.endFraction);
    }
  });

  it("survives a board where every quote is the same figure", () => {
    const axis = buildPriceAxis([quote(2500, 2500), quote(2500, 2500)])!;
    expect(axis.highMinor).toBeGreaterThan(axis.lowMinor);
    for (const bar of axis.bars) expect(Number.isFinite(bar.startFraction)).toBe(true);
  });

  it("declines to draw a comparison of one", () => {
    expect(buildPriceAxis([quote(2000, 2100)])).toBeNull();
    expect(buildPriceAxis([])).toBeNull();
  });
});

describe("who is actually distinguishable", () => {
  /*
   * The thing the chart exists to show. comparePrices knows this and says it
   * in a word on the second row of a card; two bars sharing ground says it
   * at a glance.
   */
  it("counts the rows that share ground with the leader", () => {
    const axis = buildPriceAxis([
      quote(2000, 3000, "A"),
      quote(2800, 3400, "B"), // overlaps A
      quote(9000, 9500, "C"), // clear of everything
    ])!;
    expect(axis.indistinguishableCount).toBe(2);
    expect(axis.bars.find((b) => b.quote.providerProductName === "C")!.overlapsLeader).toBe(false);
  });

  it("counts a lone leader as one", () => {
    const axis = buildPriceAxis([quote(2000, 2100), quote(9000, 9500)])!;
    expect(axis.indistinguishableCount).toBe(1);
  });

  /* Two bands that merely touch are not separated by anything. */
  it("treats touching as overlapping", () => {
    const axis = buildPriceAxis([quote(2000, 3000, "A"), quote(3000, 4000, "B")])!;
    expect(axis.indistinguishableCount).toBe(2);
  });

  it("measures overlap against the leader, not the neighbour", () => {
    const axis = buildPriceAxis([
      quote(1000, 1100, "leader"),
      quote(5000, 6000, "mid"),
      quote(5500, 7000, "high"), // overlaps mid, not the leader
    ])!;
    expect(axis.indistinguishableCount).toBe(1);
  });
});
