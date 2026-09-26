"use client";

/**
 * Is $46 a lot, for this?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The one question the model cannot answer. Asked what a fare should be,   │
 * │ it returns the number already on the screen — it has no memory and no    │
 * │ ground truth, so anything it said about "usual" would be the model       │
 * │ grading its own homework. That is the failure this codebase exists to    │
 * │ avoid, and it has been avoided by saying nothing at all.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * But the reader has seen this route before, and what they saw is a real
 * observation. Six of them make a range that belongs to them, not to the
 * model, and the comparison is honest because both ends came from the same
 * estimator on the same route.
 *
 * Which is why every sentence here is past tense and carries its n. "Toward
 * the low end of your 6 looks" is a description. "Prices are usually lower
 * now" would be a claim about the world, and nothing on this device can
 * support one.
 *
 * Below three observations this renders nothing — see MIN_SAMPLES_FOR_RANGE.
 */

import { formatMoneyMinor } from "@/lib/domain/money";
import { coarseAgeLabel } from "@/lib/domain/freshness";
import {
  cheapestLowMinor,
  historyForRoute,
  routeKeyFor,
  standingAgainstHistory,
  type TripRecord,
} from "@/lib/history/trip-log";
import type { NormalizedQuote, QuoteSession } from "@/lib/domain/types";

interface Props {
  session: QuoteSession;
  records: readonly TripRecord[];
  modelVersion: string;
}

export function RouteStanding({ session, records, modelVersion }: Props) {
  const routeKey = routeKeyFor(
    { lat: session.pickup.lat, lng: session.pickup.lng, label: "" },
    { lat: session.destination.lat, lng: session.destination.lng, label: "" },
  );

  /*
   * The current comparison is in the log by now, and including it would let a
   * fresh look set its own "lowest you have seen". It is excluded, so the
   * range is what the reader saw *before* today.
   */
  const earlier = records.filter((r) => r.id !== session.id);
  const history = historyForRoute(earlier, routeKey, modelVersion);
  if (!history) return null;

  const priced = session.quotes.filter((q: NormalizedQuote) => q.availability !== "UNAVAILABLE");
  const todayLow = cheapestLowMinor(priced.map((q) => ({ lowMinor: q.priceMinMinor })));
  if (todayLow === null) return null;

  const standing = standingAgainstHistory(todayLow, history);

  return (
    <div className={`route-standing standing-${standing.label}`}>
      <p className="route-standing-line">
        <span className="route-standing-verdict">{standing.text}</span>
      </p>
      <p className="muted fine">
        The cheapest option has run {formatMoneyMinor(history.cheapestLowMinor)} to{" "}
        {formatMoneyMinor(history.cheapestHighMinor)} across {history.n} comparisons you ran, the
        first {coarseAgeLabel(history.firstAt)}. Your own record, kept on this device — not a
        forecast, and not a claim about anyone else&rsquo;s fares.
        {history.excludedOtherModel > 0 ? (
          <>
            {" "}
            {history.excludedOtherModel} older{" "}
            {history.excludedOtherModel === 1 ? "comparison is" : "comparisons are"} left out: a
            different model version produced {history.excludedOtherModel === 1 ? "it" : "them"}.
          </>
        ) : null}
      </p>
    </div>
  );
}
