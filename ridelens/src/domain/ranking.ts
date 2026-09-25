/**
 * Ranking engine.
 *
 * Default order is cheapest-first, but "cheapest" is decided by the
 * uncertainty-aware comparator in ./uncertainty, not by a raw number sort.
 * Where two options are statistically indistinguishable we fall back to
 * deterministic tiebreakers so the list never reshuffles between renders.
 */
import { isPresentable } from './freshness';
import type { NormalizedCategory, NormalizedQuote } from './quote';
import { SEGREGATED_CATEGORIES, STANDARD_VIEW_CATEGORIES } from './taxonomy';
import {
  compareWithUncertainty,
  DEFAULT_THRESHOLDS,
  intervalOf,
  type ComparisonThresholds,
} from './uncertainty';

export const RANK_MODES = ['CHEAPEST', 'FASTEST', 'BEST_VALUE'] as const;
export type RankMode = (typeof RANK_MODES)[number];

export const FILTERS = ['BEST', 'STANDARD', 'XL', 'PREMIUM', 'TAXI', 'ALL'] as const;
export type ResultFilter = (typeof FILTERS)[number];

/** Confidence ordering used as a secondary sort — a firm price beats a guess. */
const CONFIDENCE_RANK: Record<NormalizedQuote['confidenceClass'], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
  INDETERMINATE: 3,
};

const PRICE_TYPE_RANK: Record<NormalizedQuote['priceType'], number> = {
  UPFRONT_QUOTE: 0,
  ESTIMATE: 1,
  ESTIMATE_RANGE: 2,
  METERED_ESTIMATE: 3,
  UNKNOWN: 4,
};

/**
 * Bookable means: not expired, not explicitly unavailable, and carrying a price
 * we can characterise. An UNKNOWN price type is shown but never ranked cheapest.
 *
 * UNKNOWN availability is treated as bookable on purpose: it means the source
 * did not say, not that it said no. A published taxi rate card, for instance,
 * knows the fare exactly but nothing about where the cabs are — and burying a
 * real fare because of that would be the wrong reading of silence. Only an
 * explicit UNAVAILABLE excludes an option.
 */
export function isBookable(q: NormalizedQuote): boolean {
  return isPresentable(q) && q.availability !== 'UNAVAILABLE' && q.priceType !== 'UNKNOWN';
}

export function applyFilter(quotes: NormalizedQuote[], filter: ResultFilter): NormalizedQuote[] {
  switch (filter) {
    case 'ALL':
      return quotes;
    case 'BEST':
      // "What is the sensible cheapest ride right now?" — standard-equivalent
      // supply plus taxi, because riders care about price across those.
      return quotes.filter((q) => STANDARD_VIEW_CATEGORIES.includes(q.normalizedCategory));
    case 'STANDARD':
      return quotes.filter(
        (q) => q.normalizedCategory === 'STANDARD' || q.normalizedCategory === 'ECONOMY',
      );
    case 'XL':
      return quotes.filter((q) => q.normalizedCategory === 'XL');
    case 'PREMIUM':
      return quotes.filter(
        (q) => q.normalizedCategory === 'PREMIUM' || q.normalizedCategory === 'LUXURY',
      );
    case 'TAXI':
      return quotes.filter((q) => q.normalizedCategory === 'TAXI');
    default:
      return quotes;
  }
}

/** Stable, total ordering. Unavailable and unpriceable options sink to the end. */
export function rankQuotes(
  quotes: NormalizedQuote[],
  mode: RankMode = 'CHEAPEST',
  thresholds: ComparisonThresholds = DEFAULT_THRESHOLDS,
): NormalizedQuote[] {
  const out = [...quotes];
  out.sort((a, b) => {
    const aOk = isBookable(a);
    const bOk = isBookable(b);
    if (aOk !== bOk) return aOk ? -1 : 1;

    if (mode === 'FASTEST') {
      const cmp = compareEta(a, b);
      if (cmp !== 0) return cmp;
      return comparePriceUncertain(a, b, thresholds) || tiebreak(a, b);
    }

    if (mode === 'BEST_VALUE') {
      const cmp = valueScore(a) - valueScore(b);
      if (cmp !== 0) return cmp;
      return comparePriceUncertain(a, b, thresholds) || tiebreak(a, b);
    }

    const cmp = comparePriceUncertain(a, b, thresholds);
    if (cmp !== 0) return cmp;
    // Statistically similar: prefer the firmer promise, then the faster pickup.
    const conf = CONFIDENCE_RANK[a.confidenceClass] - CONFIDENCE_RANK[b.confidenceClass];
    if (conf !== 0) return conf;
    const eta = compareEta(a, b);
    if (eta !== 0) return eta;
    return tiebreak(a, b);
  });
  return out;
}

function comparePriceUncertain(
  a: NormalizedQuote,
  b: NormalizedQuote,
  thresholds: ComparisonThresholds,
): number {
  // Cross-currency results are never numerically compared.
  if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);

  const verdict = compareWithUncertainty(intervalOf(a), intervalOf(b), thresholds);
  switch (verdict) {
    case 'A_CHEAPER':
    case 'A_LIKELY_CHEAPER':
      return -1;
    case 'B_CHEAPER':
    case 'B_LIKELY_CHEAPER':
      return 1;
    case 'SIMILAR':
      return 0;
  }
}

function compareEta(a: NormalizedQuote, b: NormalizedQuote): number {
  const ae = a.pickupEtaSeconds;
  const be = b.pickupEtaSeconds;
  if (ae === null && be === null) return 0;
  if (ae === null) return 1;
  if (be === null) return -1;
  return ae - be;
}

/**
 * Best value: a transparent, published trade-off — every 60 seconds of waiting
 * is priced at WAIT_COST_MINOR_PER_MIN. No hidden model, no "AI" scoring.
 */
export const WAIT_COST_MINOR_PER_MIN = 25; // $0.25 per minute of pickup wait

export function valueScore(q: NormalizedQuote): number {
  const waitMin = q.pickupEtaSeconds === null ? 0 : q.pickupEtaSeconds / 60;
  return q.rankingPriceMinor + Math.round(waitMin * WAIT_COST_MINOR_PER_MIN);
}

export const BEST_VALUE_EXPLANATION = `Best value ranks by price plus $${(WAIT_COST_MINOR_PER_MIN / 100).toFixed(2)} for each minute of pickup wait. Nothing else is weighted.`;

/** Fully deterministic last resort so ordering never flickers. */
function tiebreak(a: NormalizedQuote, b: NormalizedQuote): number {
  return (
    PRICE_TYPE_RANK[a.priceType] - PRICE_TYPE_RANK[b.priceType] ||
    a.provider.localeCompare(b.provider) ||
    a.providerProductId.localeCompare(b.providerProductId) ||
    a.id.localeCompare(b.id)
  );
}

/** The fastest genuinely bookable pickup, which is often not the cheapest. */
export function fastestPickup(quotes: NormalizedQuote[]): NormalizedQuote | null {
  const eligible = quotes.filter((q) => isBookable(q) && q.pickupEtaSeconds !== null);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, q) =>
    (q.pickupEtaSeconds as number) < (best.pickupEtaSeconds as number) ? q : best,
  );
}

export function groupByCategory(
  quotes: NormalizedQuote[],
): Array<{ category: NormalizedCategory; quotes: NormalizedQuote[] }> {
  const map = new Map<NormalizedCategory, NormalizedQuote[]>();
  for (const q of quotes) {
    const list = map.get(q.normalizedCategory);
    if (list) list.push(q);
    else map.set(q.normalizedCategory, [q]);
  }
  const order: NormalizedCategory[] = [
    'STANDARD',
    'ECONOMY',
    'TAXI',
    'EV',
    'SHARED',
    'ACCESSIBLE',
    'AUTONOMOUS',
    'XL',
    'PREMIUM',
    'LUXURY',
    'OTHER',
  ];
  return order
    .filter((c) => map.has(c))
    .map((category) => ({ category, quotes: map.get(category) as NormalizedQuote[] }));
}

export { SEGREGATED_CATEGORIES };
