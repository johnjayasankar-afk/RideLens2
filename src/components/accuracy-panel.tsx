"use client";

/**
 * How the estimate has done, for this rider.
 *
 * The one thing RideLens has never been able to say. `docs/CALIBRATION.md`
 * has read "the model has never been measured against a real fare" since it
 * was written, because the only question that could change that was asked at
 * a moment nobody could answer it.
 *
 * ── Facts at one, statistics at twenty ─────────────────────────────────────
 *
 * Each report is a fact and is shown immediately: the band contained the
 * fare, or it missed by this much. An average over three is not a
 * calibration, so the aggregate waits for the same `MIN_SAMPLES` the
 * published corpus is held to, and says how many more are needed rather than
 * showing a number with a caveat next to it. A number on a page gets read;
 * the caveat beside it does not.
 *
 * ── Why coverage alone is not the answer ───────────────────────────────────
 *
 * A band of $5–$500 contains every fare ever charged. So where inside the
 * band the fares landed is reported next to it: a band that is always right
 * at its very top is right in the way that is no use to anybody.
 */

import { useState } from "react";

import { coarseAgeLabel } from "@/lib/domain/freshness";
import { formatMoneyMinor } from "@/lib/domain/money";
import {
  REPORTS_FOR_ACCURACY,
  personalAccuracy,
  reportedTrips,
  unsharedReports,
} from "@/lib/history/outcome";
import type { TripRecord } from "@/lib/history/trip-log";

interface Props {
  records: readonly TripRecord[];
  onShared: (sessionId: string) => void;
}

/** Plain words for where fares landed inside the band. */
function positionReading(mean: number): string {
  if (mean < 0.35) return "fares landed toward the low end of the band";
  if (mean > 0.65) return "fares landed toward the high end of the band";
  return "fares landed around the middle of the band";
}

export function AccuracyPanel({ records, onShared }: Props) {
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reports = reportedTrips(records);
  const accuracy = personalAccuracy(records);
  const unshared = unsharedReports(records);

  if (reports.length === 0) return null;

  const share = async () => {
    setSharing(true);
    setNote(null);
    let sent = 0;
    for (const record of unshared) {
      try {
        const res = await fetch("/api/actuals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claim: record.chosen!.claim,
            signature: record.chosen!.signature,
            actualMinor: record.outcome!.actualMinor,
          }),
        });
        if (res.ok) {
          onShared(record.id);
          sent += 1;
        }
      } catch {
        /* Offline, or refused. The local record is untouched either way. */
      }
    }
    setSharing(false);
    setNote(
      sent === 0
        ? "Nothing could be sent just now. Your own record is unchanged."
        : `Sent ${sent}. Thank you — that is the only way the model gets measured.`,
    );
  };

  return (
    <section className="accuracy" aria-labelledby="accuracy-heading">
      <div className="section-label-row">
        <h2 className="section-label" id="accuracy-heading">
          How the estimate has done
        </h2>
      </div>

      {accuracy.summary ? (
        <div className="accuracy-figures">
          <p className="accuracy-headline">
            The band contained the fare{" "}
            <strong>
              {Math.round(accuracy.summary.coverage * 100)}% of {accuracy.n} trips
            </strong>{" "}
            you reported.
          </p>
          <p className="muted fine">
            Across those, {positionReading(accuracy.summary.meanPosition)}.
            {accuracy.summary.meanMissMinor != null ? (
              <>
                {" "}
                The {accuracy.summary.misses} that missed were out by{" "}
                {formatMoneyMinor(Math.round(accuracy.summary.meanMissMinor))} on average.
              </>
            ) : null}{" "}
            Your own trips only — this says nothing about anyone else&rsquo;s.
          </p>
        </div>
      ) : (
        <p className="muted accuracy-waiting">
          You have reported <strong>{accuracy.n}</strong> of {REPORTS_FOR_ACCURACY}. Below that, an
          average is not a calibration, so RideLens will not show one — it would be a number people
          read with a caveat beside it that they do not.
        </p>
      )}

      <ul className="accuracy-list">
        {reports.slice(0, 8).map((r) => (
          <li key={r.record.id} className={`accuracy-row${r.contained ? " is-hit" : " is-miss"}`}>
            <span className="accuracy-route">
              {r.record.from.label} <span aria-hidden>→</span> {r.record.to.label}
            </span>
            <span className="accuracy-numbers muted">
              said {formatMoneyMinor(r.lowMinor)}–{formatMoneyMinor(r.highMinor)}, paid{" "}
              {formatMoneyMinor(r.actualMinor)}
            </span>
            <span className="accuracy-verdict">
              {r.contained
                ? "in band"
                : `${r.missedByMinor > 0 ? "over" : "under"} by ${formatMoneyMinor(Math.abs(r.missedByMinor))}`}
            </span>
            <span className="accuracy-when muted fine">{coarseAgeLabel(r.record.outcome!.at)}</span>
          </li>
        ))}
      </ul>

      {unshared.length > 0 ? (
        <div className="accuracy-share">
          <button type="button" className="chip" onClick={() => void share()} disabled={sharing}>
            {sharing ? "Sending…" : `Contribute ${unshared.length} to calibration`}
          </button>
          {/*
            Named in full, because "share your data" is a sentence people have
            learned to distrust and being specific is the only answer to that.
          */}
          <p className="muted fine">
            Sends the distance, the time of day, the provider, the band and the fare — and a one-way
            hash of the route, rounded to about 100m. No addresses and no coordinates. It is what
            makes <code className="mono">docs/CALIBRATION.md</code> able to say anything at all.
          </p>
        </div>
      ) : null}

      {note ? (
        <p className="muted fine" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}
