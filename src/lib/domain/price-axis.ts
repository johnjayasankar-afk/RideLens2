/**
 * Putting every band on one ruler.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `comparePrices` already knows that two overlapping ranges are not        │
 * │ distinguishable, and says so in a word — "similar", "unclear". A word    │
 * │ buried on the second row of a card is not how anyone reads a price.      │
 * │ Two bars that visibly overlap is.                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The scale is shared, which is the whole point: bands drawn to their own
 * widths would make a tight, certain quote look identical to a vague one.
 * On one ruler, a wide band looks wide.
 */

import type { NormalizedQuote } from "./types";

export interface AxisBar {
  quote: NormalizedQuote;
  /** Fractions of the axis, 0–1. */
  startFraction: number;
  endFraction: number;
  /** True when this bar shares ground with the cheapest one. */
  overlapsLeader: boolean;
}

export interface PriceAxis {
  lowMinor: number;
  highMinor: number;
  bars: AxisBar[];
  /** How many bars share ground with the leader, the leader included. */
  indistinguishableCount: number;
}

/**
 * Widen a degenerate axis so an exact quote still draws as something.
 *
 * A board where every quote is the same figure has zero span. Rather than
 * divide by zero or draw nothing, give it a little room — the bars will sit
 * on top of each other, which is exactly what the reader should see.
 */
const MIN_SPAN_MINOR = 100;

export function buildPriceAxis(quotes: readonly NormalizedQuote[]): PriceAxis | null {
  const usable = quotes.filter(
    (q) => Number.isFinite(q.priceMinMinor) && Number.isFinite(q.priceMaxMinor),
  );
  if (usable.length < 2) return null;

  const lows = usable.map((q) => q.priceMinMinor);
  const highs = usable.map((q) => q.priceMaxMinor);
  const lowMinor = Math.min(...lows);
  const rawHigh = Math.max(...highs);
  const highMinor = rawHigh - lowMinor < MIN_SPAN_MINOR ? lowMinor + MIN_SPAN_MINOR : rawHigh;
  const span = highMinor - lowMinor;

  /* The leader by lowest floor — the same row the board puts first. */
  const leader = usable.reduce((a, b) => (b.priceMinMinor < a.priceMinMinor ? b : a));

  const bars: AxisBar[] = usable.map((quote) => {
    const startFraction = (quote.priceMinMinor - lowMinor) / span;
    const endFraction = (quote.priceMaxMinor - lowMinor) / span;
    return {
      quote,
      startFraction: Math.max(0, Math.min(1, startFraction)),
      endFraction: Math.max(0, Math.min(1, endFraction)),
      /* Touching counts: two bands that meet are not separated by anything. */
      overlapsLeader:
        quote === leader ||
        (quote.priceMinMinor <= leader.priceMaxMinor &&
          quote.priceMaxMinor >= leader.priceMinMinor),
    };
  });

  return {
    lowMinor,
    highMinor,
    bars,
    indistinguishableCount: bars.filter((b) => b.overlapsLeader).length,
  };
}
