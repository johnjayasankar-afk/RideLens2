/**
 * Savings copy.
 *
 * Rules: integer minor units only; never compare across currencies; never
 * claim a saving against a baseline the user cannot actually book; and never
 * assert a saving when the two prices are statistically indistinguishable.
 */
import { deltaMinor, formatMoney } from './money';
import type { NormalizedQuote } from './quote';
import { isBookable } from './ranking';
import { compareWithUncertainty, DEFAULT_THRESHOLDS, intervalOf } from './uncertainty';

export interface SavingsLine {
  /** e.g. "Save $9.12 vs UberX" — null when no honest claim is available. */
  text: string | null;
  baselineQuoteId: string | null;
  deltaMinor: number | null;
  /** True when the comparison is too close to call. */
  similar: boolean;
}

/**
 * Baseline choice, in order:
 *   1. An explicitly selected baseline (user picked a comparison anchor).
 *   2. The most widely recognised comparable provider present (Uber, then Lyft).
 *   3. The next-cheapest bookable option in the same currency.
 */
export function pickBaseline(
  candidate: NormalizedQuote,
  all: NormalizedQuote[],
  explicitBaselineId?: string,
): NormalizedQuote | null {
  const pool = all.filter(
    (q) => q.id !== candidate.id && q.currency === candidate.currency && isBookable(q),
  );
  if (pool.length === 0) return null;

  if (explicitBaselineId) {
    const explicit = pool.find((q) => q.id === explicitBaselineId);
    if (explicit) return explicit;
  }

  const sameCategory = pool.filter((q) => q.normalizedCategory === candidate.normalizedCategory);
  const searchSpace = sameCategory.length > 0 ? sameCategory : pool;

  for (const provider of ['uber', 'lyft'] as const) {
    const match = searchSpace.find((q) => q.provider === provider);
    if (match) return match;
  }

  return [...searchSpace].sort((a, b) => a.rankingPriceMinor - b.rankingPriceMinor)[0] ?? null;
}

export function savingsFor(
  candidate: NormalizedQuote,
  all: NormalizedQuote[],
  explicitBaselineId?: string,
): SavingsLine {
  const baseline = pickBaseline(candidate, all, explicitBaselineId);
  if (!baseline) return { text: null, baselineQuoteId: null, deltaMinor: null, similar: false };

  const verdict = compareWithUncertainty(
    intervalOf(candidate),
    intervalOf(baseline),
    DEFAULT_THRESHOLDS,
  );
  const delta = deltaMinor(candidate.rankingPriceMinor, baseline.rankingPriceMinor);

  if (verdict === 'SIMILAR') {
    return {
      text: `Similar price to ${baseline.providerProductName}`,
      baselineQuoteId: baseline.id,
      deltaMinor: delta,
      similar: true,
    };
  }

  if (delta >= 0) {
    // More expensive than the baseline — state the premium plainly.
    return {
      text: `+${formatMoney(delta, candidate.currency)} vs ${baseline.providerProductName}`,
      baselineQuoteId: baseline.id,
      deltaMinor: delta,
      similar: false,
    };
  }

  const hedged = verdict === 'A_LIKELY_CHEAPER';
  const amount = formatMoney(Math.abs(delta), candidate.currency);
  return {
    text: hedged
      ? `Likely saves about ${amount} vs ${baseline.providerProductName}`
      : `Save ${amount} vs ${baseline.providerProductName}`,
    baselineQuoteId: baseline.id,
    deltaMinor: delta,
    similar: false,
  };
}
