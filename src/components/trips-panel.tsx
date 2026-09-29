"use client";

/**
 * Everything the log knows, in one place.
 *
 * The recents list on the form is a shortcut; this is the record. It exists
 * to answer three questions the shortcut cannot: what has this route
 * actually cost me, what am I watching, and how do I get it out or get rid
 * of it.
 *
 * ── Why the ranges are so carefully hedged ─────────────────────────────────
 *
 * A page of routes with dollar ranges beside them looks like market data. It
 * is not: it is a record of what one person saw, on the days they happened
 * to look, from one estimator. Every range here carries its n, and routes
 * below MIN_SAMPLES_FOR_RANGE say so in words rather than showing a range
 * drawn from two observations. Records made by a different model version are
 * counted separately and named, because a figure spanning two estimators is
 * a figure no estimator ever produced.
 */

import type { Route } from "next";
import Link from "next/link";

import { coarseAgeLabel } from "@/lib/domain/freshness";
import { formatMoneyMinor } from "@/lib/domain/money";
import { exportFilename, toCsv, toJson } from "@/lib/history/export";
import {
  MIN_SAMPLES_FOR_RANGE,
  historyForRoute,
  recentTrips,
  type TripRecord,
} from "@/lib/history/trip-log";
import { AccuracyPanel } from "@/components/accuracy-panel";
import { useTripLog } from "@/components/use-trip-log";
import { usePriceWatches } from "@/components/use-price-watch";
import { MODEL_VERSION } from "@/lib/sources/ratecard/model-params";

function download(contents: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  /* Freed on the next turn, once the download has taken its reference. */
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function compareHref(record: {
  from: { lat: number; lng: number; label: string };
  to: { lat: number; lng: number; label: string };
}): Route {
  const { from, to } = record;
  return `/?from=${from.lat},${from.lng},${encodeURIComponent(from.label)}&to=${to.lat},${to.lng},${encodeURIComponent(to.label)}` as Route;
}

function RouteRow({
  record,
  records,
  onForget,
}: {
  record: TripRecord;
  records: readonly TripRecord[];
  onForget: (routeKey: string) => void;
}) {
  const history = historyForRoute(records, record.routeKey, MODEL_VERSION);
  const times = records.filter((r) => r.routeKey === record.routeKey).length;

  return (
    <li className="trip-row">
      <div className="trip-main">
        <p className="trip-route">
          {record.from.label} <span aria-hidden>→</span> {record.to.label}
        </p>
        <p className="muted fine">
          {times === 1 ? "Compared once" : `Compared ${times} times`} · last{" "}
          {coarseAgeLabel(record.at)}
          {record.miles != null ? ` · ${record.miles.toFixed(1)} mi` : ""}
        </p>
        {history ? (
          <p className="trip-range">
            Cheapest option has run {formatMoneyMinor(history.cheapestLowMinor)} to{" "}
            {formatMoneyMinor(history.cheapestHighMinor)}{" "}
            <span className="muted">across {history.n} comparisons</span>
            {history.excludedOtherModel > 0 ? (
              <span className="muted">
                {" "}
                ({history.excludedOtherModel} from an earlier model not counted)
              </span>
            ) : null}
          </p>
        ) : (
          <p className="muted fine">
            Not enough looks to give a range yet — {MIN_SAMPLES_FOR_RANGE} is the minimum, and two
            observations are an anecdote.
          </p>
        )}
      </div>
      <div className="trip-actions">
        <Link href={compareHref(record)} className="chip">
          Compare now
        </Link>
        <button
          type="button"
          className="chip chip--quiet"
          onClick={() => onForget(record.routeKey)}
        >
          Forget
        </button>
      </div>
    </li>
  );
}

export function TripsPanel() {
  const tripLog = useTripLog();
  const priceWatches = usePriceWatches();

  /* One row per route, newest first — the same collapse the form uses. */
  const routes = recentTrips(tripLog.records, 50)
    .map((t) => tripLog.records.find((r) => r.routeKey === t.routeKey))
    .filter((r): r is TripRecord => Boolean(r));

  if (routes.length === 0 && priceWatches.watches.length === 0) {
    return (
      <div className="trips-empty">
        <p>
          Nothing kept yet. Every comparison you run is recorded here — the route, the date, and the
          bands each provider showed — so that after a few looks RideLens can tell you whether today
          is one of the cheaper ones.
        </p>
        <p className="muted">
          It is stored on this device and nowhere else. There is no endpoint that accepts it.
        </p>
        <Link href="/" className="primary">
          Run a comparison
        </Link>
      </div>
    );
  }

  return (
    <div className="trips-panel">
      {/* The payoff for answering. Renders nothing until there is one. */}
      <AccuracyPanel records={tripLog.records} onShared={tripLog.noteShared} />

      {routes.length > 0 ? (
        <section aria-labelledby="trips-heading">
          <div className="section-label-row">
            <h2 className="section-label" id="trips-heading">
              Your routes
            </h2>
            <div className="trip-export">
              <button
                type="button"
                className="chip"
                onClick={() => download(toCsv(tripLog.records), exportFilename("csv"))}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => download(toJson(tripLog.records), exportFilename("json"))}
              >
                Export JSON
              </button>
            </div>
          </div>
          <ul className="trip-list">
            {routes.map((r) => (
              <RouteRow
                key={r.routeKey}
                record={r}
                records={tripLog.records}
                onForget={tripLog.forgetRoute}
              />
            ))}
          </ul>
          {/*
            The export is most obviously useful for an expense claim, which is
            exactly where it could do harm. Said here as well as in the column
            names, because the person clicking the button is the one who needs
            to read it.
          */}
          <p className="muted fine trips-note">
            The export records what RideLens <em>estimated</em> before each trip, not what you were
            charged. It has never seen a payment. Filing an estimate as an expense is a claim about
            a fare nobody observed.
          </p>
        </section>
      ) : null}

      {priceWatches.watches.length > 0 ? (
        <section aria-labelledby="watches-heading">
          <div className="section-label-row">
            <h2 className="section-label" id="watches-heading">
              Watching
            </h2>
          </div>
          <ul className="trip-list">
            {priceWatches.watches.map((w) => (
              <li className="trip-row" key={w.routeKey}>
                <div className="trip-main">
                  <p className="trip-route">
                    {w.from.label} <span aria-hidden>→</span> {w.to.label}
                  </p>
                  <p className="muted fine">
                    At or below {formatMoneyMinor(w.thresholdMinor)} · set{" "}
                    {coarseAgeLabel(w.createdAt)} · checked when you open RideLens
                  </p>
                </div>
                <div className="trip-actions">
                  <Link href={compareHref(w)} className="chip">
                    Check now
                  </Link>
                  <button
                    type="button"
                    className="chip chip--quiet"
                    onClick={() => priceWatches.remove(w.routeKey)}
                  >
                    Stop
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="muted trips-foot">
        All of this is stored on this device and nowhere else.{" "}
        <button type="button" className="linkish" onClick={tripLog.clear}>
          Forget every trip
        </button>
        {priceWatches.watches.length > 0 ? (
          <>
            {" · "}
            <button type="button" className="linkish" onClick={priceWatches.clear}>
              Clear every watch
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}
