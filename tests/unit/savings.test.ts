/**
 * The Takeaway banner's one sentence, and the figure it may not contain.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `computeSavings` had no tests, and it printed "Likely save ~$4.00 vs     │
 * │ UberX" whenever two bands overlapped by less than half and their         │
 * │ midpoints differed by two dollars or more — the partial-overlap case,    │
 * │ which is the common one. QUOTE_SEMANTICS.md:40 names it exactly: "If     │
 * │ ranges overlap significantly, relation is `similar` or `unclear`         │
 * │ ('Likely cheaper'), never a false precise '$X cheaper' claim from a      │
 * │ midpoint alone."                                                         │
 * │                                                                          │
 * │ The tilde was doing the work of an honest sentence and not doing it.     │
 * │ "~$4" is a number a reader repeats.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { describe, expect, it } from "vitest";

import { computeSavings } from "@/lib/domain/savings";
import type { NormalizedQuote } from "@/lib/domain/types";

let seq = 0;
function quote(min: number, max: number, over: Partial<NormalizedQuote> = {}): NormalizedQuote {
  seq += 1;
  return {
    id: `q${seq}`,
    provider: "uber",
    providerProductId: `p${seq}`,
    providerProductName: `Product ${seq}`,
    normalizedCategory: "STANDARD",
    priceType: "ESTIMATE_RANGE",
    priceMinMinor: min,
    priceMaxMinor: max,
    displayPriceMinor: min,
    rankingPriceMinor: Math.round((min + max) / 2),
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
    confidenceClass: "MEDIUM",
    metadata: {},
    ...over,
  };
}

/** Any money figure in the sentence, which is what the rule is about. */
const moneyIn = (text: string) => text.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? [];

describe("what the Takeaway is allowed to claim", () => {
  it("states a saving only from the gap between bounds", () => {
    const best = quote(1000, 1200, { providerProductName: "Curb Taxi", provider: "curb" });
    const baseline = quote(2000, 2400, { providerProductName: "UberX" });
    const result = computeSavings(best, baseline)!;
    /* $20.00 − $12.00 = $8.00. Never the $6.00 between the midpoints. */
    expect(result.savingsMinor).toBe(2000 - 1200);
    expect(result.text).toContain("$8.00");
  });

  it("gives the direction and no figure when the bands overlap", () => {
    /* Partial overlap: midpoints $2.50 apart, bands crossing. */
    const best = quote(1000, 1600, { providerProductName: "Curb Taxi", provider: "curb" });
    const baseline = quote(1500, 1900, { providerProductName: "UberX" });
    const result = computeSavings(best, baseline);
    if (result) {
      expect(result.savingsMinor).toBeNull();
      expect(moneyIn(result.text), `invented ${moneyIn(result.text).join(", ")}`).toEqual([]);
      expect(result.text).toContain("overlap");
    }
  });

  it("never writes a tilde-hedged figure in any arrangement of two bands", () => {
    for (let lo = 1000; lo <= 3000; lo += 100) {
      for (let width = 0; width <= 1200; width += 200) {
        const best = quote(1000, 1600);
        const baseline = quote(lo, lo + width);
        const result = computeSavings(best, baseline);
        if (!result) continue;
        expect(result.text).not.toContain("~");
        /* A figure in the sentence means a figure in the object, and that
           only ever comes from the bounds of bands that do not overlap. */
        if (moneyIn(result.text).length > 0) {
          expect(result.savingsMinor).toBe(lo - 1600);
        }
      }
    }
  });

  it("has nothing to say without a baseline", () => {
    expect(computeSavings(quote(1000, 1200), null)).toBeNull();
  });
});
