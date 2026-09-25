/**
 * Rate cards going quietly stale.
 *
 * Cities change tariffs by rulemaking and notify nobody downstream. A table
 * eighteen months out of date is the most likely way this product becomes
 * wrong — not with an error, but with a number that looks exactly like a right
 * one.
 */
import { describe, expect, it } from "vitest";

import {
  EXPIRED_AFTER_DAYS,
  RATE_CARD_VERIFIED_ON,
  STALE_AFTER_DAYS,
  rateCardFreshness,
} from "@/lib/sources/ratecard/freshness";

const daysAfter = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000);

describe("rate card freshness", () => {
  it("is quiet while the table is recent", () => {
    const f = rateCardFreshness(daysAfter(RATE_CARD_VERIFIED_ON, 10));
    expect(f.status).toBe("fresh");
    expect(f.warning).toBeNull();
  });

  it("warns once it passes the staleness threshold", () => {
    const f = rateCardFreshness(daysAfter(RATE_CARD_VERIFIED_ON, STALE_AFTER_DAYS + 1));
    expect(f.status).toBe("stale");
    expect(f.warning).toMatch(/re-read the published rates/i);
  });

  it("escalates past a year", () => {
    const f = rateCardFreshness(daysAfter(RATE_CARD_VERIFIED_ON, EXPIRED_AFTER_DAYS + 1));
    expect(f.status).toBe("expired");
    expect(f.warning).toMatch(/nobody has checked in a year/i);
  });

  /*
   * The guard that makes this more than a display. It fails the build once the
   * committed date ages out, so the product starts erroring rather than
   * quietly serving prices from figures nobody has checked.
   *
   * If this fails: re-read the published tariffs and move the date. Moving the
   * date without doing the work converts a known staleness into an unknown
   * one, which is strictly worse than the failure.
   */
  it("fails the build before the committed date ages out", () => {
    const f = rateCardFreshness();
    expect(
      f.status,
      `Rate cards were verified ${f.ageDays} days ago. Re-verify and update RATE_CARD_VERIFIED_ON.`,
    ).not.toBe("expired");
  });

  it("keeps the thresholds in a sane order", () => {
    expect(STALE_AFTER_DAYS).toBeGreaterThan(0);
    expect(EXPIRED_AFTER_DAYS).toBeGreaterThan(STALE_AFTER_DAYS);
    expect(Number.isNaN(Date.parse(RATE_CARD_VERIFIED_ON))).toBe(false);
  });
});
