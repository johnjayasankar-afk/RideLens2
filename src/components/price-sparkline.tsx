"use client";

/**
 * What this route has cost you, as a shape.
 *
 * The sentence beside it already says the range and the count. A line says
 * the thing a sentence is bad at: whether today is unusual, and whether the
 * price has been drifting or just bouncing.
 *
 * ── Why it is drawn rather than plotted ────────────────────────────────────
 *
 * Inline SVG, no chart library. There are at most a few dozen points, the
 * shape is a polyline, and the alternative costs more kilobytes than the
 * whole comparison page.
 *
 * ── What it is careful about ───────────────────────────────────────────────
 *
 * The y-axis does not start at zero, because these are fares within a narrow
 * band and a zero baseline would flatten every one of them into the same
 * line. That exaggerates variation, so the axis is labelled with its own
 * low and high — the reader can see the scale it is drawn on.
 *
 * It renders nothing below three points; `historySeries` enforces that, and
 * the sentence next to it is already refusing for the same reason.
 */

import { formatMoneyMinor } from "@/lib/domain/money";
import type { HistoryPoint } from "@/lib/history/trip-log";

interface Props {
  points: readonly HistoryPoint[];
  /** Today's cheapest, marked against the history. */
  todayLowMinor: number;
  /**
   * The scale to draw on, taken from the summary sentence beside this.
   *
   * Derived independently, the chart labelled itself "$72.00 to $84.00" — the
   * range of the lows it plots — under a sentence reading "$72.00 to $85.50",
   * the low-of-lows to high-of-highs. Both were right about different things,
   * which is no use to a reader looking at them together. One scale, one pair
   * of numbers.
   */
  scaleLowMinor: number;
  scaleHighMinor: number;
}

const W = 132;
const H = 34;
const PAD = 3;

export function PriceSparkline({ points, todayLowMinor, scaleLowMinor, scaleHighMinor }: Props) {
  if (points.length < 3) return null;

  /* The summary's bounds, widened only if today falls outside them. */
  const min = Math.min(scaleLowMinor, todayLowMinor, ...points.map((p) => p.lowMinor));
  const max = Math.max(scaleHighMinor, todayLowMinor, ...points.map((p) => p.lowMinor));
  /* A flat history would divide by zero; draw it down the middle instead. */
  const span = max - min || 1;

  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.lowMinor).toFixed(1)}`).join(" ");
  const area = `${PAD},${H - PAD} ${line} ${(W - PAD).toFixed(1)},${H - PAD}`;
  const todayY = y(todayLowMinor);

  return (
    <figure className="spark">
      <svg
        className="spark-svg"
        viewBox={`0 0 ${W} ${H}`}
        /* The width comes from the panel, not from W: see .spark in
           globals.css. `none` so the shape stretches to fill it rather than
           sitting 132px wide in the middle of 700px of nothing; the strokes
           carry vector-effect so they do not stretch with it. */
        preserveAspectRatio="none"
        role="img"
        aria-label={`Your ${points.length} previous comparisons of this route ran ${formatMoneyMinor(min)} to ${formatMoneyMinor(max)}. Today is ${formatMoneyMinor(todayLowMinor)}.`}
      >
        <polygon className="spark-area" points={area} />
        <polyline className="spark-line" points={line} />
        {/* Today, against that history. */}
        <line className="spark-today" x1={PAD} x2={W - PAD} y1={todayY} y2={todayY} />
        {/* A zero-length line with a square cap, which is the only marker
            shape that survives a non-uniform stretch: a circle becomes an
            ellipse and a rect becomes a bar, but a cap is drawn from the
            stroke, and the stroke is non-scaling. */}
        <line className="spark-now" x1={W - PAD} y1={todayY} x2={W - PAD} y2={todayY} />
      </svg>
      <figcaption className="spark-scale" aria-hidden>
        <span>{formatMoneyMinor(min)}</span>
        <span>{formatMoneyMinor(max)}</span>
      </figcaption>
    </figure>
  );
}
