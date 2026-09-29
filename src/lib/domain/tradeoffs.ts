/**
 * What the more expensive option actually buys.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The cards already say "+$31.65 vs best · +2 min wait". Two numbers side  │
 * │ by side, and the reader does the division in their head — badly, because │
 * │ the wait is not the thing that matters. What matters is door to door,    │
 * │ and the question is whether the gap is worth the money.                  │
 * │                                                                          │
 * │ Divide one by the other and you get a rate: what you would be paying,    │
 * │ per hour, for the time the pricier option saves. That is a number a      │
 * │ person can hold against their own hourly rate and decide in a second.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── The refusals ───────────────────────────────────────────────────────────
 *
 * Both durations here are modeled to the minute, so their difference is only
 * meaningful above the resolution of the thing producing it. Under two minutes
 * this reports `TOO_CLOSE` rather than a rate — $31.65 for "one minute faster"
 * computes to $1,899 an hour and every digit of it is noise.
 *
 * And when an option costs more without arriving sooner, there is no rate to
 * quote and no trade-off to weigh. It says so. Most of the time, on most
 * routes, that is the honest finding and it is the useful one.
 */

import { comparePrices } from "./ranking";
import type { NormalizedQuote } from "./types";

/**
 * Below this, the difference is smaller than the model can resolve.
 *
 * Trip durations come out of an OSRM free-flow estimate scaled by a
 * time-of-day factor. Neither input is accurate to the minute, so a one-minute
 * gap between two of them carries no information at all.
 */
export const RESOLUTION_MINUTES = 2;

export type TradeoffKind =
  /** Costs more, arrives sooner. There is a rate. */
  | "BUYS_TIME"
  /** Costs more, arrives no sooner. */
  | "BUYS_NOTHING"
  /** Costs more, and the time difference is inside the model's resolution. */
  | "TOO_CLOSE"
  /** One of the two durations is missing. */
  | "UNKNOWN"
  /**
   * Its band overlaps the cheapest one, so there is no extra to weigh.
   *
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ The ledger used to compute `extraMinor` as one ranking midpoint minus  │
   * │ another and then divide it by a real duration, presenting the result   │
   * │ as "$31/hour". A fabricated numerator over a measured denominator is   │
   * │ still fabricated, and dressing it as a rate makes it look derived.     │
   * │ Live, the Spread panel showed Curb $16.37–$17.88 against Lyft          │
   * │ $20.48–$22.02 while the ledger printed "Lyft +$4.12"; the gap between  │
   * │ those bounds is $2.60. QUOTE_SEMANTICS.md:40 forbids the first figure  │
   * │ and :42 permits only the second.                                       │
   * └────────────────────────────────────────────────────────────────────────┘
   *
   * So a row whose band overlaps the reference reports that, and reports no
   * figure. "It might not cost more at all" is the honest answer to "what
   * does paying more buy?" when the model cannot tell that you are paying
   * more.
   */
  | "PRICE_OVERLAPS";

export interface Tradeoff {
  quoteId: string;
  provider: string;
  productName: string;
  kind: TradeoffKind;
  /**
   * Minor units above the reference: the gap between the bounds, never
   * between the midpoints. Zero on `PRICE_OVERLAPS`, where there is no
   * defensible figure at all.
   */
  extraMinor: number;
  /** Door to door: waiting for the car plus sitting in it. Null when unknown. */
  minutesSaved: number | null;
  /**
   * Dollars per hour the extra works out to, for `BUYS_TIME` only.
   *
   * Null everywhere else, deliberately: a field that is sometimes a rate and
   * sometimes a placeholder gets rendered as a rate.
   */
  dollarsPerHour: number | null;
}

export interface TradeoffLedger {
  /** The cheapest option, which everything else is measured against. */
  referenceId: string;
  referenceName: string;
  rows: Tradeoff[];
  /** One sentence over the table, or null when there is nothing to say. */
  headline: string | null;
}

/** Waiting for it plus riding in it. Null unless both are known. */
export function doorToDoorSeconds(q: NormalizedQuote): number | null {
  const wait = q.pickupEtaSeconds;
  const drive = q.tripDurationSeconds;
  if (wait == null || drive == null) return null;
  return wait + drive;
}

function label(q: NormalizedQuote): string {
  return q.providerProductName || q.provider;
}

/**
 * Every option against the cheapest one.
 *
 * The reference is the cheapest by ranking price whatever the list is sorted
 * by, so the extras are never negative and the rates never invert. Returns
 * null when there is nothing to compare.
 */
export function buildTradeoffs(quotes: readonly NormalizedQuote[]): TradeoffLedger | null {
  if (quotes.length < 2) return null;

  const cheapest = quotes.reduce((best, q) =>
    q.rankingPriceMinor < best.rankingPriceMinor ? q : best,
  );
  const referenceDoor = doorToDoorSeconds(cheapest);

  const rows: Tradeoff[] = [];
  for (const q of quotes) {
    if (q.id === cheapest.id) continue;
    /*
     * The extra, from `comparePrices` — the same overlap-aware helper the
     * cards and the console register go through. It yields a figure only
     * where the two bands are clear of each other, and computes it from the
     * bounds.
     */
    const against = comparePrices(q, cheapest);
    /*
     * Two cases are not trade-offs at all and keep their old treatment of
     * being left out: a price level with the reference buys nothing and
     * would divide by zero, and a row that is *cheaper* by its bounds is not
     * something anybody is paying extra for — the reference is picked by
     * ranking midpoint, so a wider band can sit below it.
     */
    if (against.relation === "cheaper") continue;
    if (against.relation === "similar" && against.savingsMinor === 0) continue;
    if (against.relation !== "more_expensive" || !against.savingsMinor) {
      rows.push({
        quoteId: q.id,
        provider: q.provider,
        productName: label(q),
        kind: "PRICE_OVERLAPS",
        extraMinor: 0,
        minutesSaved: null,
        dollarsPerHour: null,
      });
      continue;
    }
    const extraMinor = against.savingsMinor;

    const door = doorToDoorSeconds(q);
    if (referenceDoor === null || door === null) {
      rows.push({
        quoteId: q.id,
        provider: q.provider,
        productName: label(q),
        kind: "UNKNOWN",
        extraMinor,
        minutesSaved: null,
        dollarsPerHour: null,
      });
      continue;
    }

    const minutesSaved = Math.round(((referenceDoor - door) / 60) * 10) / 10;
    if (minutesSaved <= 0) {
      rows.push({
        quoteId: q.id,
        provider: q.provider,
        productName: label(q),
        kind: "BUYS_NOTHING",
        extraMinor,
        minutesSaved,
        dollarsPerHour: null,
      });
      continue;
    }
    if (minutesSaved < RESOLUTION_MINUTES) {
      rows.push({
        quoteId: q.id,
        provider: q.provider,
        productName: label(q),
        kind: "TOO_CLOSE",
        extraMinor,
        minutesSaved,
        dollarsPerHour: null,
      });
      continue;
    }

    rows.push({
      quoteId: q.id,
      provider: q.provider,
      productName: label(q),
      kind: "BUYS_TIME",
      extraMinor,
      minutesSaved,
      dollarsPerHour: Math.round((extraMinor / 100 / (minutesSaved / 60)) * 100) / 100,
    });
  }

  if (rows.length === 0) return null;
  return {
    referenceId: cheapest.id,
    referenceName: label(cheapest),
    rows,
    headline: headlineFor(rows, label(cheapest)),
  };
}

function headlineFor(rows: readonly Tradeoff[], reference: string): string | null {
  const buys = rows.filter((r) => r.kind === "BUYS_TIME");
  if (buys.length === 0) {
    const anyKnown = rows.some((r) => r.kind === "BUYS_NOTHING" || r.kind === "TOO_CLOSE");
    return anyKnown
      ? `Nothing here buys you time. ${reference} is both the cheapest and no slower than anything above it.`
      : null;
  }
  /* The best deal on time is the cheapest rate, not the biggest saving. */
  const best = buys.reduce((b, r) => (r.dollarsPerHour! < b.dollarsPerHour! ? r : b));
  return (
    `${best.productName} gets you there ${formatMinutes(best.minutesSaved!)} sooner than ` +
    `${reference}, at $${best.dollarsPerHour!.toFixed(0)} an hour for the time saved.`
  );
}

export function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 1) return "under a minute";
  return `${rounded} min`;
}
