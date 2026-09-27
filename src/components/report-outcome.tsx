"use client";

/**
 * "What did it actually cost?", asked at a moment the rider can answer.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This question already existed. It was on the handoff page — the          │
 * │ interstitial shown while the rider is being sent to the provider — so it │
 * │ arrived before they had taken the trip, on a page they pass through in   │
 * │ two seconds on their way out. Nobody could answer it, and the            │
 * │ calibration corpus has held zero records since it was built.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So it is asked on the way back instead, about a trip they chose, once
 * enough time has passed for it to be over. The prediction is stated before
 * the question, because a question that hides what it is checking invites
 * the answer it wants.
 *
 * ── What it offers in return ───────────────────────────────────────────────
 *
 * The count is not a progress bar for its own sake. RideLens cannot tell
 * anyone how good its estimates are until it has been told, and the honest
 * version of "please help" is to say exactly what the help buys: at
 * REPORTS_FOR_ACCURACY reports, the rider gets their own calibration. That
 * is a real thing, it is theirs, and it needs no sharing.
 *
 * Sharing is a separate act, offered on /trips, never here. This form writes
 * to the device and nowhere else.
 */

import { useState } from "react";

import { coarseAgeLabel } from "@/lib/domain/freshness";
import { formatMoneyMinor, minorToDollars } from "@/lib/domain/money";
import { REPORTS_FOR_ACCURACY } from "@/lib/history/outcome";
import type { TripRecord } from "@/lib/history/trip-log";

interface Props {
  trip: TripRecord;
  /** How many the rider has already reported. */
  reported: number;
  onReport: (actualMinor: number) => void;
  onDismiss: () => void;
}

export function ReportOutcome({ trip, reported, onReport, onDismiss }: Props) {
  const [draft, setDraft] = useState("");
  const chosen = trip.chosen;
  if (!chosen) return null;

  const parsed = Number.parseFloat(draft);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const remaining = Math.max(0, REPORTS_FOR_ACCURACY - reported);

  return (
    <form
      className="report-outcome"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onReport(Math.round(parsed * 100));
      }}
      aria-labelledby="report-outcome-q"
    >
      <p className="report-outcome-q" id="report-outcome-q">
        {coarseAgeLabel(chosen.at)} you opened {chosen.product} for {trip.from.label} →{" "}
        {trip.to.label}. What did it come to?
      </p>

      {/* Said before the question, not after it. */}
      <p className="muted fine">
        RideLens estimated {formatMoneyMinor(chosen.lowMinor)} to{" "}
        {formatMoneyMinor(chosen.highMinor)}. If you did not take it, skip.
      </p>

      <div className="report-outcome-row">
        <span className="report-outcome-currency" aria-hidden>
          $
        </span>
        <input
          className="report-outcome-input"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="What the trip actually cost, in dollars"
          placeholder={String(minorToDollars(chosen.lowMinor).toFixed(2))}
        />
        <button type="submit" className="chip" disabled={!valid}>
          Save
        </button>
        <button type="button" className="chip ghost" onClick={onDismiss}>
          Skip
        </button>
      </div>

      <p className="muted fine">
        {remaining > 0 ? (
          <>
            Kept on this device. {remaining} more and RideLens can tell you how its estimates have
            done for you.
          </>
        ) : (
          <>Kept on this device. See how the estimates have done on your trips page.</>
        )}
      </p>
    </form>
  );
}
