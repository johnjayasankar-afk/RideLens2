"use client";

/**
 * Every band on one ruler.
 *
 * `comparePrices` already knows two overlapping ranges are not
 * distinguishable and says so in a word on the second row of a card — which
 * is not how anyone reads a price. Two bars that visibly share ground is.
 *
 * One shared scale, deliberately. Bands drawn to their own widths would make
 * a tight, certain quote look exactly like a vague one; on a common ruler a
 * wide band looks wide.
 */

import { formatMoneyMinor } from "@/lib/domain/money";
import { buildPriceAxis } from "@/lib/domain/price-axis";
import type { NormalizedQuote } from "@/lib/domain/types";

export function PriceAxis({ quotes }: { quotes: readonly NormalizedQuote[] }) {
  const axis = buildPriceAxis(quotes);
  if (!axis) return null;

  const overlapping = axis.indistinguishableCount;

  return (
    <section className="axis" aria-labelledby="axis-heading">
      <div className="axis-head">
        <h2 id="axis-heading" className="section-label">
          Side by side
        </h2>
        {overlapping > 1 ? (
          <span className="axis-verdict">
            {overlapping} options are the same price, within their ranges
          </span>
        ) : (
          <span className="axis-verdict is-clear">The cheapest is clear of the rest</span>
        )}
      </div>

      <ul className="axis-bars">
        {axis.bars.map((bar) => {
          const left = `${(bar.startFraction * 100).toFixed(2)}%`;
          const width = `${Math.max(1.5, (bar.endFraction - bar.startFraction) * 100).toFixed(2)}%`;
          const exact = bar.quote.priceMinMinor === bar.quote.priceMaxMinor;
          return (
            <li className="axis-row" key={bar.quote.id}>
              <span className="axis-name">{bar.quote.providerProductName}</span>
              <span className="axis-track">
                <span
                  className="axis-bar"
                  data-overlaps={bar.overlapsLeader ? "true" : "false"}
                  style={{ left, width }}
                  /*
                   * The bar is decoration; the row's own text carries the
                   * numbers, so a screen reader is not read a chart.
                   */
                  aria-hidden
                />
              </span>
              <span className="axis-value">
                {exact
                  ? formatMoneyMinor(bar.quote.priceMinMinor)
                  : `${formatMoneyMinor(bar.quote.priceMinMinor)}–${formatMoneyMinor(bar.quote.priceMaxMinor)}`}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="axis-scale" aria-hidden>
        <span>{formatMoneyMinor(axis.lowMinor)}</span>
        <span>{formatMoneyMinor(axis.highMinor)}</span>
      </div>

      {overlapping > 1 ? (
        <p className="axis-note">
          Bars that share ground are not separated by anything this model can measure. Picking
          between them on price alone would be picking at random.
        </p>
      ) : null}
    </section>
  );
}
