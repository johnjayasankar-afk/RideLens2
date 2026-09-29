"use client";

/**
 * What the extra buys, priced by the hour.
 *
 * The cards already print "+$31.65 vs best · +2 min wait" and leave the
 * reader to divide. This does the division, against door-to-door time rather
 * than the wait, and then refuses to print it whenever the division is not
 * meaningful — which on a typical route is most of the rows.
 *
 * The refusals carry the panel. "Nothing here buys you time" is the finding a
 * rider can act on, and it is the one a table of two columns cannot state.
 */

import { formatMoneyMinor } from "@/lib/domain/money";
import { buildTradeoffs, formatMinutes, RESOLUTION_MINUTES } from "@/lib/domain/tradeoffs";
import type { NormalizedQuote } from "@/lib/domain/types";

export function TradeoffLedger({ quotes }: { quotes: readonly NormalizedQuote[] }) {
  const ledger = buildTradeoffs(quotes);
  if (!ledger) {
    return (
      <p className="deck-empty muted">
        One option, or everything priced level. There is no extra here to weigh.
      </p>
    );
  }

  return (
    <div className="ledger">
      {ledger.headline ? <p className="ledger-headline">{ledger.headline}</p> : null}

      <ul className="ledger-list">
        {ledger.rows.map((row) => (
          <li className="ledger-row" key={row.quoteId} data-kind={row.kind}>
            <span className="ledger-name">{row.productName}</span>
            <span className="ledger-extra">
              {row.kind === "PRICE_OVERLAPS" ? "—" : `+${formatMoneyMinor(row.extraMinor)}`}
            </span>
            <span className="ledger-verdict">
              {row.kind === "BUYS_TIME" ? (
                <>
                  <strong>${row.dollarsPerHour!.toFixed(0)}/hour</strong>
                  <span className="muted"> for {formatMinutes(row.minutesSaved!)} saved</span>
                </>
              ) : row.kind === "BUYS_NOTHING" ? (
                /*
                 * The number, not the word. `minutesSaved` is computed
                 * door-to-door and is negative here, and the row printed
                 * "and arrives later" over the top of it — the one figure
                 * that tells a reader whether "later" means ninety seconds
                 * or a quarter of an hour, thrown away at the last step.
                 */
                <span className="muted">
                  {row.minutesSaved === 0 || row.minutesSaved == null
                    ? "and arrives at the same time"
                    : `and arrives ${formatMinutes(Math.abs(row.minutesSaved))} later`}
                </span>
              ) : row.kind === "TOO_CLOSE" ? (
                <span className="muted">
                  for a gap under {RESOLUTION_MINUTES} min — smaller than the model can resolve
                </span>
              ) : row.kind === "PRICE_OVERLAPS" ? (
                <span className="muted">
                  its range overlaps the cheapest — it may not cost more at all
                </span>
              ) : (
                <span className="muted">no duration to compare</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="deck-foot muted">
        Measured against {ledger.referenceName}, the cheapest here, door to door — waiting for the
        car plus sitting in it. Both durations are modeled, so a gap under {RESOLUTION_MINUTES}{" "}
        minutes gets no rate: dividing a real price by an imaginary minute produces a confident
        number and no information.
      </p>
    </div>
  );
}
