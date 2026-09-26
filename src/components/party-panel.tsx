"use client";

/**
 * What it costs each, once there is more than one of you.
 *
 * A board sorted by total price reads wrong for a group. An UberX at $70 is
 * not $70 for five people — it is two cars — and the XL that looked like the
 * expensive option is quietly the cheap one. Nothing on the screen marked
 * where that flips.
 *
 * Sits beside the comparison rather than replacing it. The total is what
 * actually leaves someone's account, and per-head is the number the group
 * argues about; both are worth having, and swapping one for the other would
 * just move the confusion.
 */

import { useState } from "react";

import { formatMoneyMinor } from "@/lib/domain/money";
import { MAX_PARTY, splitBoard } from "@/lib/domain/party";
import type { NormalizedQuote } from "@/lib/domain/types";

export function PartyPanel({ quotes }: { quotes: readonly NormalizedQuote[] }) {
  const [party, setParty] = useState(1);
  if (quotes.length === 0) return null;

  const { rows, crossover } = splitBoard(quotes, party);
  const clamp = (n: number) => Math.max(1, Math.min(MAX_PARTY, n));

  return (
    <section className="party" aria-labelledby="party-heading">
      <div className="party-head">
        <h2 id="party-heading" className="section-label">
          Split it
        </h2>
        <div className="party-stepper" role="group" aria-label="Party size">
          <button
            type="button"
            className="ghost"
            onClick={() => setParty((p) => clamp(p - 1))}
            disabled={party <= 1}
            aria-label="One fewer person"
          >
            −
          </button>
          <span className="party-count" aria-live="polite">
            {party} {party === 1 ? "person" : "people"}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => setParty((p) => clamp(p + 1))}
            disabled={party >= MAX_PARTY}
            aria-label="One more person"
          >
            +
          </button>
        </div>
      </div>

      {party === 1 ? (
        <p className="party-hint muted">
          Add people to see the cost per head, and where a bigger car starts winning.
        </p>
      ) : (
        <>
          {crossover ? <p className="party-crossover">{crossover.sentence}</p> : null}

          <ul className="party-list">
            {rows.map((row) => (
              <li
                key={row.quote.id}
                className="party-row"
                data-refused={row.refusal ? "" : undefined}
              >
                <span className="party-name">
                  {row.quote.providerProductName}
                  {row.splitAcrossVehicles ? (
                    <span className="party-cars"> × {row.vehicles} cars</span>
                  ) : null}
                </span>
                {row.refusal ? (
                  <span className="party-refusal muted">{row.refusal}</span>
                ) : (
                  <span className="party-price">
                    {formatMoneyMinor(row.perPersonLowMinor)}
                    {row.perPersonHighMinor !== row.perPersonLowMinor
                      ? `–${formatMoneyMinor(row.perPersonHighMinor)}`
                      : ""}
                    <span className="muted"> each</span>
                  </span>
                )}
              </li>
            ))}
          </ul>

          {rows.some((r) => r.splitAcrossVehicles && !r.refusal) ? (
            /*
             * The caveat that keeps this honest. Two cars is not two times
             * one car: separate requests, separate surge, separate drivers,
             * and they do not arrive together. The arithmetic is fine; the
             * claim that the answer is a fare would not be.
             */
            <p className="party-note">
              More than one car means separate requests — each gets its own price and its own
              driver, and they will not arrive together. Those totals are arithmetic, not a quote.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
