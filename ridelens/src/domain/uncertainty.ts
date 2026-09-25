/**
 * Uncertainty-aware price comparison.
 *
 * The failure this module exists to prevent: an exact $25.00 upfront fare and
 * a $20–40 estimate range are NOT comparable by taking 20 < 25. The range's
 * own midpoint is $30, its low end is a marketing floor, and asserting "the
 * $20 ride is cheaper" is a claim the data does not support.
 *
 * We model each quote as an interval plus a confidence class, then compare
 * intervals rather than points.
 */
import type { ConfidenceClass, NormalizedQuote, PriceType } from './quote';

export interface PriceInterval {
  lowMinor: number;
  highMinor: number;
  /** Point estimate used only to break ties. */
  centerMinor: number;
  confidence: ConfidenceClass;
}

/** Relative half-width above which a range stops being a useful point predictor. */
const WIDE_RANGE_BPS = 1500; // 15% of the center

export function confidenceFor(
  priceType: PriceType,
  lowMinor: number,
  highMinor: number,
): ConfidenceClass {
  switch (priceType) {
    case 'UPFRONT_QUOTE':
      return 'HIGH';
    case 'ESTIMATE':
      return 'MEDIUM';
    case 'METERED_ESTIMATE':
      // A meter outcome depends on traffic we cannot see.
      return 'LOW';
    case 'ESTIMATE_RANGE': {
      const width = relativeWidthBps(lowMinor, highMinor);
      if (width === null) return 'INDETERMINATE';
      return width <= WIDE_RANGE_BPS ? 'MEDIUM' : 'LOW';
    }
    case 'UNKNOWN':
    default:
      return 'INDETERMINATE';
  }
}

/** Range width as basis points of the midpoint. Null when undefined. */
export function relativeWidthBps(lowMinor: number, highMinor: number): number | null {
  const center = (lowMinor + highMinor) / 2;
  if (center <= 0) return null;
  return Math.round(((highMinor - lowMinor) / center) * 10_000);
}

export function intervalOf(q: NormalizedQuote): PriceInterval {
  return {
    lowMinor: q.priceMinMinor,
    highMinor: q.priceMaxMinor,
    centerMinor: q.rankingPriceMinor,
    confidence: q.confidenceClass,
  };
}

export type ComparisonVerdict =
  /** a is cheaper and the intervals do not meaningfully overlap. */
  | 'A_CHEAPER'
  | 'B_CHEAPER'
  /** Intervals overlap enough that neither can be called cheaper. */
  | 'SIMILAR'
  /** a is probably cheaper but the claim is not certain. */
  | 'A_LIKELY_CHEAPER'
  | 'B_LIKELY_CHEAPER';

/**
 * Overlap fraction relative to the narrower interval. A point price is treated
 * as a zero-width interval, so "does $25 fall inside $20–40?" is answerable.
 */
export function overlapRatio(a: PriceInterval, b: PriceInterval): number {
  const lo = Math.max(a.lowMinor, b.lowMinor);
  const hi = Math.min(a.highMinor, b.highMinor);
  const overlap = hi - lo;
  if (overlap < 0) return 0;

  const widthA = a.highMinor - a.lowMinor;
  const widthB = b.highMinor - b.lowMinor;
  const narrower = Math.min(widthA, widthB);

  // A zero-width interval that lands inside the other is total containment.
  if (narrower === 0) return overlap >= 0 ? 1 : 0;
  return Math.min(1, overlap / narrower);
}

export interface ComparisonThresholds {
  /** Overlap at or above this reads as "similar price". */
  similarOverlap: number;
  /** Overlap below this permits a confident cheaper/expensive claim. */
  confidentOverlap: number;
  /** Center gap below this (minor units) reads as similar regardless of overlap. */
  negligibleGapMinor: number;
}

export const DEFAULT_THRESHOLDS: ComparisonThresholds = {
  similarOverlap: 0.6,
  confidentOverlap: 0.15,
  negligibleGapMinor: 100, // $1.00
};

export function compareWithUncertainty(
  a: PriceInterval,
  b: PriceInterval,
  t: ComparisonThresholds = DEFAULT_THRESHOLDS,
): ComparisonVerdict {
  const gap = Math.abs(a.centerMinor - b.centerMinor);
  const aCheaper = a.centerMinor < b.centerMinor;
  const overlap = overlapRatio(a, b);

  if (gap <= t.negligibleGapMinor) return 'SIMILAR';
  if (overlap >= t.similarOverlap) return 'SIMILAR';

  // Either side being indeterminate downgrades any claim to "likely".
  const shaky =
    a.confidence === 'INDETERMINATE' ||
    b.confidence === 'INDETERMINATE' ||
    a.confidence === 'LOW' ||
    b.confidence === 'LOW';

  if (overlap <= t.confidentOverlap && !shaky) {
    return aCheaper ? 'A_CHEAPER' : 'B_CHEAPER';
  }
  return aCheaper ? 'A_LIKELY_CHEAPER' : 'B_LIKELY_CHEAPER';
}

/** UI copy for the top result, chosen from its verdict against the runner-up. */
export function headlineFor(
  verdict: ComparisonVerdict,
): 'Best price' | 'Likely cheapest' | 'Similar price' {
  switch (verdict) {
    case 'A_CHEAPER':
      return 'Best price';
    case 'A_LIKELY_CHEAPER':
      return 'Likely cheapest';
    default:
      return 'Similar price';
  }
}
