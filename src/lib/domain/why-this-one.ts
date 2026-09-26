/**
 * Why this one is on top, when that is not obvious.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A sorted list asserts an ordering and explains nothing. That is fine     │
 * │ while the top row is plainly cheapest — and misleading the moment it is  │
 * │ not: sorted by arrival, or carrying the widest band on the board, or     │
 * │ ahead of the second row by less than either of their ranges.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Every sentence here is built from `comparePrices`, so this can never claim
 * a saving the comparison itself would refuse to assert. Where the two rows
 * are indistinguishable it says so, which is the case that matters most: a
 * rider looking at a list assumes the top of it won something.
 *
 * Returns null when the ordering speaks for itself. A note on every card is
 * a note nobody reads.
 */

import { comparePrices } from "./ranking";
import type { NormalizedQuote, RankingMode } from "./types";

export interface WinnerNote {
  /** One sentence, already hedged, safe to render as-is. */
  sentence: string;
  /** Why it was worth saying — for styling and for tests. */
  reason: "not_cheapest" | "too_close_to_call" | "wide_band";
}

function providerName(q: NormalizedQuote): string {
  return q.providerProductName || q.provider;
}

function minutes(seconds: number | null): number | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return Math.max(0, Math.round(seconds / 60));
}

function money(minor: number): string {
  return `$${(Math.abs(minor) / 100).toFixed(2)}`;
}

/**
 * The cheapest row by the same rules the board uses.
 *
 * Deliberately not `Math.min` on a midpoint: two quotes whose bands overlap
 * have no cheaper one, and picking by midpoint would invent the distinction
 * that comparePrices exists to refuse.
 */
export function clearlyCheapest(quotes: readonly NormalizedQuote[]): NormalizedQuote | null {
  if (quotes.length === 0) return null;
  let best = quotes[0]!;
  for (const q of quotes.slice(1)) {
    if (comparePrices(q, best).relation === "cheaper") best = q;
  }
  // Only a row that beats every other outright counts as the cheapest.
  for (const q of quotes) {
    if (q === best) continue;
    if (comparePrices(best, q).relation !== "cheaper") return null;
  }
  return best;
}

export function explainWinner(
  ranked: readonly NormalizedQuote[],
  mode: RankingMode,
): WinnerNote | null {
  const hero = ranked[0];
  const runnerUp = ranked[1];
  if (!hero || !runnerUp) return null;

  const cheapest = clearlyCheapest(ranked);

  /*
   * Sorted by something other than price, and the top row is not the cheapest
   * one. This is the case a plain list gets most wrong.
   */
  if (cheapest && cheapest !== hero) {
    const gap = comparePrices(cheapest, hero);
    const heroWait = minutes(hero.pickupEtaSeconds);
    const cheapWait = minutes(cheapest.pickupEtaSeconds);
    const saving = gap.savingsMinor;

    if (mode === "fastest" && heroWait != null && cheapWait != null && cheapWait > heroWait) {
      const waited = cheapWait - heroWait;
      const cost = saving ? ` for ${money(saving)} less` : "";
      return {
        reason: "not_cheapest",
        sentence: `Top because it arrives soonest. ${providerName(cheapest)} is ${waited} min further out${cost}.`,
      };
    }

    if (saving) {
      const waitPart =
        heroWait != null && cheapWait != null && cheapWait > heroWait
          ? `, and waits ${cheapWait - heroWait} min longer`
          : "";
      return {
        reason: "not_cheapest",
        sentence: `Not the cheapest — ${providerName(cheapest)} is at least ${money(saving)} less${waitPart}.`,
      };
    }

    return {
      reason: "not_cheapest",
      sentence: `Not the cheapest on price. ${providerName(cheapest)} ranks lower for wait or certainty.`,
    };
  }

  /*
   * Nothing separates the top two. The list still had to put one first, and
   * a rider reading a ranking will assume that meant something.
   */
  const headToHead = comparePrices(hero, runnerUp);
  if (headToHead.relation === "similar" || headToHead.relation === "unclear") {
    return {
      reason: "too_close_to_call",
      sentence: `Too close to call against ${providerName(runnerUp)} — the two ranges overlap, so treat them as the same price.`,
    };
  }

  /*
   * It did win, but on the least certain number on the board. Worth one
   * sentence: the band is doing the work, not the model.
   */
  if (hero.confidenceClass === "LOW" || hero.confidenceClass === "UNCERTAIN") {
    const width = hero.priceMaxMinor - hero.priceMinMinor;
    if (width > 0) {
      return {
        reason: "wide_band",
        sentence: `Cheapest here, but on the widest range on the board — ${money(width)} between its ends.`,
      };
    }
  }

  return null;
}
