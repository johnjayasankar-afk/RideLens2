"use client";

/**
 * Where the money goes, for every option at once.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ One breakdown at a time answers "why is this $107". Every breakdown on   │
 * │ one scale answers the better question: *what is different* between the   │
 * │ $79 and the $107. Almost always it is the ride, not the fees — the       │
 * │ statutory stack is nearly identical across providers on the same route,  │
 * │ and seeing that is worth more than any single total.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Bars share one scale, so the widths are comparable rather than each option
 * filling its own row. A fee slice that looks small here is small.
 *
 * ── What it prints, and what it will not ───────────────────────────────────
 *
 * Each row decomposes the modeled centre and prints the band beside it, so
 * the figure being sliced is never mistaken for the price. An option whose
 * source did not decompose itself is listed without a bar rather than given
 * an invented one.
 */

import { useState } from "react";

import { composeFare, type FareComposition } from "@/lib/domain/fare-composition";
import { formatMoneyMinor } from "@/lib/domain/money";
import type { NormalizedQuote } from "@/lib/domain/types";

interface Row {
  quote: NormalizedQuote;
  composition: FareComposition | null;
}

function dollars(n: number): string {
  return formatMoneyMinor(Math.round(n * 100));
}

export function FareCompositionPanel({ quotes }: { quotes: readonly NormalizedQuote[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (quotes.length === 0) return null;

  const rows: Row[] = quotes.map((quote) => ({ quote, composition: composeFare(quote) }));
  const priced = rows.filter((r) => r.composition !== null);
  if (priced.length === 0) {
    return (
      <p className="deck-empty muted">
        These prices arrived from their sources as totals. There is no arithmetic behind them to
        take apart.
      </p>
    );
  }

  /*
   * One scale for every bar, so a wide slice is a large number.
   *
   * Taken from the longest *drawn* bar rather than the largest centre. A
   * negative slice is struck back off the end, so a bar is as long as its
   * positive parts; scaled to centres, the dearest option's bar saturated at
   * 100% and its strike-back fell off the right edge, which is the one row
   * where it is most worth seeing. The solid part of every bar still ends at
   * its own centre over the same scale, which is the comparison that matters.
   */
  const scale = Math.max(
    ...priced.map((r) =>
      r.composition!.slices.reduce((t, s) => (s.dollars > 0 ? t + s.dollars : t), 0),
    ),
  );

  return (
    <div className="comp">
      <ul className="comp-list">
        {rows.map(({ quote, composition }) => {
          const open = openId === quote.id;
          const feeItems = composition?.slices.find((s) => s.id === "fees")?.items ?? [];
          /* What the negative slices take back off the end of the bar. */
          const taken = (composition?.slices ?? []).reduce(
            (t, s) => (s.dollars < 0 ? t - s.dollars : t),
            0,
          );
          return (
            <li className="comp-row" key={quote.id}>
              <div className="comp-top">
                <span className="comp-name">{quote.providerProductName}</span>
                <span className="comp-figure">
                  {composition ? (
                    <>
                      <strong>{dollars(composition.centerDollars)}</strong>
                      <span className="muted">
                        {" "}
                        centre · {formatMoneyMinor(quote.priceMinMinor)}–
                        {formatMoneyMinor(quote.priceMaxMinor)}
                      </span>
                    </>
                  ) : (
                    <span className="muted">No breakdown published</span>
                  )}
                </span>
              </div>

              {composition ? (
                <>
                  {/*
                    A slice can be negative, and a stacked bar cannot draw a
                    negative width. Drawn as positives alone the bar ended at
                    the parts' sum rather than at the centre — a $42.90 fare
                    filling to $47.66 on a scale shared with options whose
                    bars were honest.

                    So the positives run at true scale and the negative is
                    struck back off the end of them: the solid bar stops
                    exactly at the centre, and the hatched tail is the amount
                    that was taken off. The arithmetic is the same either way;
                    only this version is legible.
                  */}
                  <div
                    className="comp-bar"
                    role="img"
                    aria-label={`${quote.providerProductName}: ${composition.slices
                      .map(
                        (s) =>
                          `${s.label} ${s.dollars < 0 ? "minus " : ""}${dollars(Math.abs(s.dollars))}`,
                      )
                      .join(", ")}. Modeled centre ${dollars(composition.centerDollars)}.`}
                  >
                    {composition.slices.map((slice) =>
                      slice.dollars > 0 ? (
                        <span
                          key={slice.id}
                          className="comp-seg"
                          data-slice={slice.id}
                          style={{ width: `${(slice.dollars / scale) * 100}%` }}
                        />
                      ) : null,
                    )}
                    {taken > 0 ? (
                      <span
                        className="comp-taken"
                        aria-hidden
                        style={{
                          left: `${(composition.centerDollars / scale) * 100}%`,
                          width: `${(taken / scale) * 100}%`,
                        }}
                      />
                    ) : null}
                  </div>

                  <div className="comp-legend">
                    {composition.slices.map((slice) => (
                      <span className="comp-key" key={slice.id}>
                        <span className="comp-dot" data-slice={slice.id} aria-hidden />
                        {slice.label}
                        <strong>
                          {slice.dollars < 0 ? "−" : ""}
                          {dollars(Math.abs(slice.dollars))}
                        </strong>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="comp-more"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : quote.id)}
                    >
                      {open ? "Hide" : "Explain"}
                    </button>
                  </div>

                  {/*
                    Every slice says what it is, then the fees are itemised.
                    The disclosure used to appear only where there were fee
                    lines to show, which meant the one slice a reader is most
                    likely to query — a signed corridor or directional
                    adjustment that moves the price and names no charge — was
                    the one with nothing to open.
                  */}
                  {open ? (
                    <div className="comp-why">
                      <dl className="comp-defs">
                        {composition.slices.map((slice) => (
                          <div key={slice.id}>
                            <dt>
                              <span className="comp-dot" data-slice={slice.id} aria-hidden />
                              {slice.label}
                            </dt>
                            <dd>{slice.detail}</dd>
                          </div>
                        ))}
                      </dl>
                      {feeItems.length > 0 ? (
                        <ul className="comp-items">
                          {feeItems.map((item) => (
                            <li key={item.label}>
                              <span>{item.label}</span>
                              <span className="comp-item-amount">
                                {item.dollars < 0 ? "−" : ""}
                                {dollars(Math.abs(item.dollars))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="deck-foot muted">
        Each bar takes apart the modeled centre — the figure the engine computes before widening it
        into the band printed beside it. The market tick multiplies the ride portion inside the
        engine; splitting it out would need a pre-tick fare no source publishes, so it is stated on
        the cards rather than drawn here.
      </p>
    </div>
  );
}
