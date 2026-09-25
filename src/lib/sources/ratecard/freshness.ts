/**
 * How old the rate cards are, and when that becomes a problem.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE QUIET FAILURE                                                        │
 * │                                                                          │
 * │ Cities change tariffs by rulemaking and notify nobody downstream. NYC's  │
 * │ congestion pricing has moved more than once. A rate card silently        │
 * │ eighteen months out of date is the most likely way this product becomes  │
 * │ wrong — not with an error, but with a number that looks exactly like a   │
 * │ right one.                                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * rates.ts carries one comment — "RideWise / published rate cards (Sep 2026)"
 * — covering all 49 markets. That is the honest granularity available: nobody
 * has verified them individually, and inventing 49 per-card dates to make this
 * module look thorough would be a fabrication of exactly the kind the rest of
 * the codebase refuses.
 *
 * So there is one date, it covers the whole table, and it says so.
 */

/**
 * When the rate-card table was last checked against its sources.
 *
 * Covers the whole table. Update it only after actually re-reading the
 * published tariffs — moving the date without doing the work converts a known
 * staleness into an unknown one, which is strictly worse.
 */
export const RATE_CARD_VERIFIED_ON = "2026-09-01";

/** Past this, the table is old enough to warn about. */
export const STALE_AFTER_DAYS = 120;

/**
 * Past this it should not be quietly serving prices at all.
 *
 * A test asserts the date is inside this window, so the build starts failing
 * rather than the product starting to lie.
 */
export const EXPIRED_AFTER_DAYS = 365;

export type Staleness = "fresh" | "stale" | "expired";

export interface RateCardFreshness {
  verifiedOn: string;
  ageDays: number;
  status: Staleness;
  /** One sentence for the admin page, or null when there is nothing to say. */
  warning: string | null;
}

export function rateCardFreshness(now: Date = new Date()): RateCardFreshness {
  const verified = Date.parse(RATE_CARD_VERIFIED_ON);
  const ageDays = Math.floor((now.getTime() - verified) / 86_400_000);

  const status: Staleness =
    ageDays >= EXPIRED_AFTER_DAYS ? "expired" : ageDays >= STALE_AFTER_DAYS ? "stale" : "fresh";

  const warning =
    status === "fresh"
      ? null
      : status === "stale"
        ? `Rate cards were last verified ${ageDays} days ago (${RATE_CARD_VERIFIED_ON}). Tariffs change by rulemaking with no downstream notice; re-read the published rates.`
        : `Rate cards are ${ageDays} days old (${RATE_CARD_VERIFIED_ON}) and past the ${EXPIRED_AFTER_DAYS}-day limit. Every fare on the site is being computed from figures nobody has checked in a year.`;

  return { verifiedOn: RATE_CARD_VERIFIED_ON, ageDays, status, warning };
}
