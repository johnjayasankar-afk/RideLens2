/**
 * The capture that closes the loop.
 *
 * Everything in src/lib/eval scores predictions against these rows. Without
 * them docs/CALIBRATION.md can only say it does not know, which is what it
 * says today.
 */
import { describe, expect, it } from "vitest";

import { routeHash, validateReport } from "@/lib/eval/actuals";
import type { NormalizedQuote, QuoteSession } from "@/lib/domain/types";

const session = {
  pickup: { lat: 40.72251, lng: -73.99455, formattedAddress: "14 Prince St" },
  destination: { lat: 40.64461, lng: -73.77972, formattedAddress: "JFK" },
} as QuoteSession;

const quote = (over: Partial<NormalizedQuote> = {}) =>
  ({
    priceMinMinor: 2400,
    priceMaxMinor: 2900,
    provider: "uber",
    currency: "USD",
    receivedAt: new Date().toISOString(),
    providerProductId: "uberx",
    metadata: {},
    ...over,
  }) as NormalizedQuote;

describe("routeHash", () => {
  /*
   * Rounded to about 100m: finer and a corridor never accumulates enough
   * samples to report, coarser and two different trips merge.
   */
  it("groups two starts on the same block", () => {
    const a = routeHash(session);
    const b = routeHash({
      ...session,
      // ~20 m away, and inside the same bucket.
      pickup: { ...session.pickup, lat: 40.7227, lng: -73.9946 },
    } as QuoteSession);
    expect(a).toBe(b);
  });

  /*
   * Any grid has edges: two points ten metres apart either side of one get
   * different hashes. That is inherent and acceptable — it costs a little
   * grouping, never correctness, since each record carries its own prediction.
   */
  it("is a grid, with the edges a grid implies", () => {
    // 40.7224 rounds to .722, 40.7226 to .723 — twenty metres, two buckets.
    const left = routeHash({
      ...session,
      pickup: { ...session.pickup, lat: 40.7224 },
    } as QuoteSession);
    const right = routeHash({
      ...session,
      pickup: { ...session.pickup, lat: 40.7226 },
    } as QuoteSession);
    expect(left).not.toBe(right);
  });

  it("separates genuinely different trips", () => {
    const other = routeHash({
      ...session,
      destination: { ...session.destination, lat: 40.78, lng: -73.87 },
    } as QuoteSession);
    expect(other).not.toBe(routeHash(session));
  });

  /* A hash is not a location: it must not carry full precision. */
  it("does not preserve the original coordinates", () => {
    expect(routeHash(session)).not.toContain("40.72251");
  });
});

describe("validating a report", () => {
  it("accepts a plausible fare", () => {
    expect(validateReport({ session, quote: quote(), actualMinor: 2680 })).toBeNull();
  });

  it("rejects zero and negatives", () => {
    expect(validateReport({ session, quote: quote(), actualMinor: 0 })).toMatch(/more than zero/);
    expect(validateReport({ session, quote: quote(), actualMinor: -5 })).toMatch(/more than zero/);
  });

  /*
   * A mistyped amount that lands in the corpus poisons every statistic
   * computed from it, and nobody ever goes back to look.
   */
  it("rejects an amount no fare reaches", () => {
    expect(validateReport({ session, quote: quote(), actualMinor: 2_000_000 })).toMatch(
      /higher than any fare/,
    );
  });

  it("rejects a non-number", () => {
    expect(validateReport({ session, quote: quote(), actualMinor: NaN })).toMatch(/not a number/);
  });

  it("refuses a quote with nothing to compare against", () => {
    expect(
      validateReport({ session, quote: quote({ priceMinMinor: 0 }), actualMinor: 2680 }),
    ).toMatch(/no price to compare/);
  });
});
