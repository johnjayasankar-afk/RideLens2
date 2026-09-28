"use client";

/**
 * What it costs each, and what it costs out the door.
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
 *
 * ── The tip ────────────────────────────────────────────────────────────────
 *
 * Every figure this product prints excludes the tip, and the brief the
 * assistant works from has to say so out loud because a rider reading "$79.30"
 * is not thinking about the twenty per cent they are about to add. A taxi
 * meter asks at the end; the apps ask after the ride. It is the single
 * largest thing standing between the number on this page and the number on
 * somebody's statement.
 *
 * It is also not a model output and must never look like one. A tip is
 * arithmetic the rider chooses, applied to an estimate — so it is off by
 * default, it is never folded into a ranking, and the line under it says
 * whose number it is.
 */

import { useState } from "react";

import { formatMoneyMinor } from "@/lib/domain/money";
import { MAX_PARTY, splitBoard } from "@/lib/domain/party";
import type { NormalizedQuote } from "@/lib/domain/types";

/** Off first. The others are what the apps themselves offer. */
const TIPS = [0, 15, 18, 20, 25] as const;

export function PartyPanel({
  quotes,
  embedded,
}: {
  quotes: readonly NormalizedQuote[];
  /**
   * Rendered inside the insights deck, which supplies the heading.
   *
   * The heading stays in the accessibility tree rather than being deleted —
   * `aria-labelledby` points at it, and a section that loses its name is a
   * worse trade than a duplicated one.
   */
  embedded?: boolean;
}) {
  const [party, setParty] = useState(1);
  const [tip, setTip] = useState<number>(0);
  if (quotes.length === 0) return null;

  const { rows, crossover } = splitBoard(quotes, party);
  const clamp = (n: number) => Math.max(1, Math.min(MAX_PARTY, n));
  const tipped = (minor: number) => Math.round(minor * (1 + tip / 100));

  return (
    <section className="party" aria-labelledby="party-heading">
      {/* Both dials on one line: how many of you, and what you are adding. */}
      <div className="party-head">
        <h2 id="party-heading" className={embedded ? "sr-only" : "section-label"}>
          Split it
        </h2>
        <div className="party-dials">
          <span className="party-tips-label" id="party-tip-label">
            Tip
          </span>
          <div className="segmented" role="group" aria-labelledby="party-tip-label">
            {TIPS.map((pct) => (
              <button
                key={pct}
                type="button"
                className={`chip${pct === tip ? " active" : ""}`}
                aria-pressed={pct === tip}
                onClick={() => setTip(pct)}
              >
                {pct === 0 ? "None" : `${pct}%`}
              </button>
            ))}
          </div>
        </div>
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

      {crossover && party > 1 ? <p className="party-crossover">{crossover.sentence}</p> : null}

      <ul className="party-list">
        {rows.map((row) => (
          <li key={row.quote.id} className="party-row" data-refused={row.refusal ? "" : undefined}>
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
                {formatMoneyMinor(tipped(row.perPersonLowMinor))}
                {row.perPersonHighMinor !== row.perPersonLowMinor
                  ? `–${formatMoneyMinor(tipped(row.perPersonHighMinor))}`
                  : ""}
                <span className="muted"> {party === 1 ? "out the door" : "each"}</span>
              </span>
            )}
          </li>
        ))}
      </ul>

      {party === 1 ? (
        <p className="party-hint muted">
          Add people to see the cost per head, and where a bigger car starts winning.
        </p>
      ) : null}

      {tip > 0 ? (
        /*
         * Said whenever a tip is on, and not before. It is the rider's
         * arithmetic on top of an estimate, and the ranking above has not
         * moved — a tip is a percentage, so it cannot change an order.
         */
        <p className="party-note">
          {tip}% of the estimate, added here. No provider has been asked about it, it is not part of
          any figure elsewhere on this page, and it does not change which option is cheapest.
        </p>
      ) : null}

      {rows.some((r) => r.splitAcrossVehicles && !r.refusal) ? (
        /*
         * The caveat that keeps this honest. Two cars is not two times
         * one car: separate requests, separate surge, separate drivers,
         * and they do not arrive together. The arithmetic is fine; the
         * claim that the answer is a fare would not be.
         */
        <p className="party-note">
          More than one car means separate requests — each gets its own price and its own driver,
          and they will not arrive together. Those totals are arithmetic, not a quote.
        </p>
      ) : null}
    </section>
  );
}
