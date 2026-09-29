/**
 * The ledger's value is in what it declines to divide.
 *
 * A rate is one number over another, and both of these are modeled. Most of
 * these cases are about the arithmetic not running when the inputs cannot
 * carry it.
 */

import { describe, expect, it } from "vitest";

import { RESOLUTION_MINUTES, buildTradeoffs, doorToDoorSeconds } from "@/lib/domain/tradeoffs";
import type { NormalizedQuote } from "@/lib/domain/types";

let seq = 0;
/**
 * Prices are exact here unless a test asks for a band.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This fixture pinned every quote to the same 5000–5400 band and let tests │
 * │ vary `rankingPriceMinor` alone. That made the midpoint the only thing    │
 * │ separating two options — which is exactly the quantity the ledger is now │
 * │ forbidden to subtract, so every case was written on the one input that   │
 * │ may not be used.                                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * An exact price has no midpoint to fabricate: the band is a point, the two
 * are clear of each other, and `comparePrices` returns their difference from
 * the bounds. Every case below keeps the figure it was written for, and now
 * keeps it for a reason the contract allows. The overlapping case gets its
 * own tests at the bottom, where it belongs.
 */
function quote(over: Partial<NormalizedQuote> = {}): NormalizedQuote {
  seq += 1;
  const exact = over.rankingPriceMinor ?? 5200;
  return {
    id: `q${seq}`,
    provider: "uber",
    providerProductId: "uberx",
    providerProductName: "UberX",
    normalizedCategory: "STANDARD",
    priceType: "UPFRONT_QUOTE",
    priceMinMinor: exact,
    priceMaxMinor: exact,
    displayPriceMinor: exact,
    rankingPriceMinor: exact,
    currency: "USD",
    pickupEtaSeconds: 180,
    tripDurationSeconds: 1800,
    distanceMeters: 16000,
    availability: "AVAILABLE",
    source: "public_rate_card",
    sourceMethod: "public_rate_card",
    accountContext: "PUBLIC",
    receivedAt: "2026-09-27T12:00:00.000Z",
    providerTimestamp: null,
    expiresAt: null,
    freshness: "LIVE",
    bookingHandoff: null,
    confidenceClass: "HIGH",
    metadata: {},
    ...over,
  };
}

describe("what the extra buys", () => {
  it("measures door to door, not just the wait", () => {
    expect(doorToDoorSeconds(quote({ pickupEtaSeconds: 120, tripDurationSeconds: 900 }))).toBe(
      1020,
    );
    expect(doorToDoorSeconds(quote({ tripDurationSeconds: null }))).toBeNull();
    expect(doorToDoorSeconds(quote({ pickupEtaSeconds: null }))).toBeNull();
  });

  /* $12 for 20 minutes is $36 an hour. */
  it("turns the gap into a rate a person can hold against their own", () => {
    const ledger = buildTradeoffs([
      quote({ rankingPriceMinor: 4000, pickupEtaSeconds: 300, tripDurationSeconds: 2400 }),
      quote({
        providerProductName: "Comfort",
        rankingPriceMinor: 5200,
        pickupEtaSeconds: 180,
        tripDurationSeconds: 1920,
      }),
    ])!;
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]!.kind).toBe("BUYS_TIME");
    expect(ledger.rows[0]!.extraMinor).toBe(1200);
    expect(ledger.rows[0]!.minutesSaved).toBe(10);
    expect(ledger.rows[0]!.dollarsPerHour).toBe(72);
  });

  /*
   * The finding that is true most of the time, and the one worth printing:
   * paying more often gets you nothing at all.
   */
  it("says plainly when the extra buys nothing", () => {
    const ledger = buildTradeoffs([
      quote({ rankingPriceMinor: 4000, pickupEtaSeconds: 120, tripDurationSeconds: 1800 }),
      quote({
        providerProductName: "Lyft",
        rankingPriceMinor: 6000,
        pickupEtaSeconds: 420,
        tripDurationSeconds: 2100,
      }),
    ])!;
    expect(ledger.rows[0]!.kind).toBe("BUYS_NOTHING");
    expect(ledger.rows[0]!.dollarsPerHour).toBeNull();
    expect(ledger.headline).toContain("Nothing here buys you time");
  });

  /*
   * One modeled minute against another is not a minute. Dividing by it here
   * would print $1,899 an hour with a straight face.
   */
  it("refuses a rate when the gap is inside the model's resolution", () => {
    const ledger = buildTradeoffs([
      quote({ rankingPriceMinor: 4000, pickupEtaSeconds: 180, tripDurationSeconds: 1860 }),
      quote({
        providerProductName: "Comfort",
        rankingPriceMinor: 7165,
        pickupEtaSeconds: 180,
        tripDurationSeconds: 1800,
      }),
    ])!;
    expect(ledger.rows[0]!.kind).toBe("TOO_CLOSE");
    expect(ledger.rows[0]!.minutesSaved).toBe(1);
    expect(ledger.rows[0]!.dollarsPerHour).toBeNull();
  });

  it("uses a stated resolution rather than a number buried in a branch", () => {
    expect(RESOLUTION_MINUTES).toBeGreaterThanOrEqual(2);
  });

  it("refuses when a duration is missing entirely", () => {
    const ledger = buildTradeoffs([
      quote({ rankingPriceMinor: 4000 }),
      quote({ rankingPriceMinor: 6000, tripDurationSeconds: null }),
    ])!;
    expect(ledger.rows[0]!.kind).toBe("UNKNOWN");
    expect(ledger.rows[0]!.minutesSaved).toBeNull();
  });

  /*
   * Whatever the list is sorted by, the cheapest is the reference — otherwise
   * "what the extra buys" is measured against something that is not cheaper,
   * and the rates come out negative.
   */
  it("measures against the cheapest whatever order it arrives in", () => {
    const rows = buildTradeoffs([
      quote({ providerProductName: "Lyft", rankingPriceMinor: 9000 }),
      quote({ providerProductName: "UberX", rankingPriceMinor: 6000 }),
      quote({ providerProductName: "Curb Taxi", rankingPriceMinor: 4000 }),
    ])!;
    expect(rows.referenceName).toBe("Curb Taxi");
    expect(rows.rows.map((r) => r.extraMinor)).toEqual([5000, 2000]);
    for (const row of rows.rows) expect(row.extraMinor).toBeGreaterThan(0);
  });

  it("drops an option priced level with the reference rather than dividing by zero", () => {
    const ledger = buildTradeoffs([
      quote({ rankingPriceMinor: 4000 }),
      quote({ providerProductName: "Lyft", rankingPriceMinor: 4000 }),
      quote({ providerProductName: "Comfort", rankingPriceMinor: 5000 }),
    ])!;
    expect(ledger.rows.map((r) => r.productName)).toEqual(["Comfort"]);
  });

  it("has nothing to say about a single option", () => {
    expect(buildTradeoffs([quote()])).toBeNull();
    expect(buildTradeoffs([])).toBeNull();
  });

  /* The best deal on time is the cheapest rate, not the largest saving. */
  it("leads with the cheapest hour, not the biggest gap", () => {
    const ledger = buildTradeoffs([
      quote({
        providerProductName: "Curb Taxi",
        rankingPriceMinor: 4000,
        tripDurationSeconds: 3600,
      }),
      /* 30 min saved for $30 — $60/h. */
      quote({ providerProductName: "UberX", rankingPriceMinor: 7000, tripDurationSeconds: 1800 }),
      /* 5 min saved for $2 — $24/h. */
      quote({ providerProductName: "Lyft", rankingPriceMinor: 4200, tripDurationSeconds: 3300 }),
    ])!;
    expect(ledger.headline).toContain("Lyft");
    expect(ledger.headline).toContain("$24 an hour");
  });
});

/**
 * The case the ledger used to answer with a number it had invented.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Captured live before the fix: the Spread panel showed Curb $16.37–$17.88 │
 * │ and Lyft $20.48–$22.02 for one session, while the ledger printed "Lyft   │
 * │ +$4.12" — one ranking midpoint minus the other. The gap between those    │
 * │ bounds is $2.60. Worse, that fabricated figure was then divided by a     │
 * │ real duration and rendered as "$X/hour", which reads as derived.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
describe("when the model cannot tell that you are paying more", () => {
  const band = (
    name: string,
    min: number,
    max: number,
    trip: number,
  ): Parameters<typeof buildTradeoffs>[0][number] =>
    quote({
      providerProductName: name,
      priceType: "ESTIMATE_RANGE",
      confidenceClass: "MEDIUM",
      priceMinMinor: min,
      priceMaxMinor: max,
      rankingPriceMinor: Math.round((min + max) / 2),
      tripDurationSeconds: trip,
    });

  it("reports the overlap instead of an extra, and offers no rate", () => {
    const ledger = buildTradeoffs([
      band("Curb Taxi", 1637, 1788, 1800),
      band("Lyft", 1600, 2202, 1200),
    ])!;
    const row = ledger.rows.find((r) => r.productName === "Lyft")!;
    expect(row.kind).toBe("PRICE_OVERLAPS");
    expect(row.extraMinor).toBe(0);
    expect(row.dollarsPerHour).toBeNull();
  });

  it("still states an extra where the bands are clear of each other", () => {
    const ledger = buildTradeoffs([
      band("Curb Taxi", 1637, 1788, 1800),
      band("Lyft", 2048, 2202, 1200),
    ])!;
    const row = ledger.rows.find((r) => r.productName === "Lyft")!;
    /* $20.48 − $17.88 = $2.60, the gap between the bounds. Never $4.12. */
    expect(row.extraMinor).toBe(2048 - 1788);
    expect(row.kind).toBe("BUYS_TIME");
  });

  it("never divides a rate out of an extra it does not have", () => {
    const ledger = buildTradeoffs([
      band("Curb Taxi", 1637, 1788, 1800),
      band("Lyft", 1600, 2202, 600),
    ])!;
    for (const row of ledger.rows) {
      if (row.dollarsPerHour != null) expect(row.extraMinor).toBeGreaterThan(0);
    }
  });
});
