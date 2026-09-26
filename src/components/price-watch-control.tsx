"use client";

/**
 * A standing question about this trip.
 *
 * The honest framing is the whole design. A control that says "watch" next
 * to a price reads as a promise to come and find you, and RideLens cannot
 * do that — there is no server polling the route and no channel to send on.
 * So the disclosure is not fine print tucked under a disclosure triangle; it
 * is the sentence directly under the control, and it comes from
 * `WATCH_DISCLOSURE`, which a test refuses to let anyone make friendlier.
 *
 * What it *can* do is answer the moment you look, which for somebody who
 * prices the same run twice a week is most of the value and none of the lie.
 */

import { useState } from "react";

import { formatMoneyMinor, minorToDollars } from "@/lib/domain/money";
import {
  WATCH_DISCLOSURE,
  makeWatch,
  suggestThresholdMinor,
  type PriceWatch,
  type WatchResult,
} from "@/lib/history/price-watch";
import type { LoggedEndpoint } from "@/lib/history/trip-log";

interface Props {
  from: LoggedEndpoint;
  to: LoggedEndpoint;
  cheapestLowMinor: number;
  watch: PriceWatch | null;
  result: WatchResult | null;
  onSet: (watch: PriceWatch) => void;
  onRemove: (routeKey: string) => void;
}

export function PriceWatchControl({
  from,
  to,
  cheapestLowMinor,
  watch,
  result,
  onSet,
  onRemove,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  /* Met, and worth leading with: the answer to the question they set. */
  if (watch && result?.met) {
    return (
      <div className="watch met">
        <p className="watch-line">
          <span className="watch-verdict">
            Under your {formatMoneyMinor(watch.thresholdMinor)} watch —{" "}
            {formatMoneyMinor(result.cheapestLowMinor)} now
          </span>
        </p>
        <p className="muted fine">
          {WATCH_DISCLOSURE}{" "}
          <button type="button" className="linkish" onClick={() => onRemove(watch.routeKey)}>
            Stop watching
          </button>
        </p>
      </div>
    );
  }

  if (watch) {
    return (
      <div className="watch">
        <p className="watch-line">
          <span className="watch-status muted">
            Watching for {formatMoneyMinor(watch.thresholdMinor)} or less. Cheapest right now is{" "}
            {formatMoneyMinor(cheapestLowMinor)}.
          </span>
        </p>
        <p className="muted fine">
          {WATCH_DISCLOSURE}{" "}
          <button type="button" className="linkish" onClick={() => onRemove(watch.routeKey)}>
            Stop watching
          </button>
        </p>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="watch">
        <button
          type="button"
          className="chip watch-start"
          onClick={() => {
            setDraft(String(minorToDollars(suggestThresholdMinor(cheapestLowMinor))));
            setEditing(true);
          }}
        >
          Tell me when it drops
        </button>
      </div>
    );
  }

  const parsed = Number.parseFloat(draft);
  const valid = Number.isFinite(parsed) && parsed > 0;

  return (
    <form
      className="watch watch-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSet(makeWatch(from, to, Math.round(parsed * 100)));
        setEditing(false);
      }}
    >
      <label className="watch-label" htmlFor="watch-threshold">
        Tell me when this trip is at or below
      </label>
      <div className="watch-row">
        <span className="watch-currency" aria-hidden>
          $
        </span>
        <input
          id="watch-threshold"
          className="watch-input"
          type="number"
          inputMode="decimal"
          min="1"
          step="1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          /* Autofocus is right here: the control was just opened by a
             deliberate click, and the field is the only thing in it. */
          autoFocus
        />
        <button type="submit" className="chip" disabled={!valid}>
          Watch
        </button>
        <button type="button" className="chip ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      <p className="muted fine">{WATCH_DISCLOSURE}</p>
    </form>
  );
}
