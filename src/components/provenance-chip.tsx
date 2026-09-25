"use client";

/**
 * Three words on the card, and the whole arithmetic one tap away.
 *
 * The decomposition has always been computed — ComputedFare carries
 * feeBreakdown and marketplaceFactors — and nothing rendered it. A price with
 * its construction shown is a different kind of claim from a price on its own,
 * and it is the claim this product can actually support.
 */
import { useEffect, useId, useRef, useState } from "react";

import {
  bandNote,
  provenanceOf,
  provenanceRows,
  type ProvenanceRow,
} from "@/lib/domain/provenance";
import type { NormalizedQuote } from "@/lib/domain/types";

function formatValue(row: ProvenanceRow): string {
  // A value already expressed as text — a duration, or the band on the total
  // row — is printed as it stands. Coercing it produced "$NaN".
  if (typeof row.value === "string") return row.value;
  if (row.kind === "factor") return `×${row.value.toFixed(2)}`;
  return `${row.value < 0 ? "−" : ""}$${Math.abs(row.value).toFixed(2)}`;
}

export function ProvenanceChip({ quote }: { quote: NormalizedQuote }) {
  const [open, setOpen] = useState(false);
  const prov = provenanceOf(quote);
  const rows = provenanceRows(quote);
  const dialogId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const dismiss = () => {
    setOpen(false);
    openerRef.current?.focus();
  };

  const market = typeof quote.metadata?.marketNote === "string" ? quote.metadata.marketNote : null;
  const feeGap =
    typeof quote.metadata?.feeModelNote === "string" ? quote.metadata.feeModelNote : null;

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={`prov-chip prov-${prov.kind.toLowerCase()}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="provenance-chip"
      >
        <span aria-hidden className="prov-dot" />
        {prov.label}
        <span className="sr-only"> — how we got this number</span>
      </button>

      {open ? (
        <div className="prov-scrim" onClick={dismiss} data-testid="provenance-scrim">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            className="prov-sheet"
            onClick={(e) => e.stopPropagation()}
            data-testid="provenance-sheet"
          >
            <header className="prov-sheet-head">
              <div>
                <p className="eyebrow">{prov.label}</p>
                <h2 id={`${dialogId}-title`}>How we got this number</h2>
              </div>
              <button ref={closeRef} type="button" className="ghost" onClick={dismiss}>
                Close
              </button>
            </header>

            <p className="prov-summary">{prov.summary}</p>
            {market ? <p className="prov-market">{market}</p> : null}
            {feeGap ? (
              <p className="prov-market prov-gap" data-testid="fee-gap">
                {feeGap}
              </p>
            ) : null}

            {rows.length > 0 ? (
              <dl className="prov-rows">
                {rows.map((row, i) => (
                  <div key={`${row.label}-${i}`} className={`prov-row prov-row-${row.kind}`}>
                    <dt>
                      {row.label}
                      {row.detail ? <span className="prov-detail">{row.detail}</span> : null}
                    </dt>
                    <dd className="tnum">{formatValue(row)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              /*
               * A partner hands over a number and no arithmetic. Inventing a
               * breakdown for it would be worse than admitting there isn't one.
               */
              <p className="prov-summary muted">
                This source supplied a figure without a breakdown, so there is nothing to itemise.
              </p>
            )}

            <p className="prov-band">{bandNote(quote)}</p>

            {prov.modeled ? (
              <p className="prov-warn">
                Nothing here is a fare anyone has promised you. Confirm in the provider&rsquo;s app
                before you ride.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
