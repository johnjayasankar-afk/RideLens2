/**
 * Closing the loop between what was predicted and what it cost.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `docs/CALIBRATION.md` has said the same thing since it was written: the  │
 * │ model has never been measured against a real fare. Every other honesty   │
 * │ measure in this product — the provenance chip, the widened bands, the    │
 * │ refusal to name a winner on overlapping bands — describes how a number   │
 * │ was made. None of them says whether it was right.                        │
 * │                                                                          │
 * │ The machinery to find out already existed. It asked at the wrong moment. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The question went on the handoff page — the interstitial shown *before*
 * the rider leaves for the provider. At that moment they have not taken the
 * trip, so the only honest answer is "I don't know yet", and the page is one
 * they pass through in two seconds on their way out. A rider who came back
 * later, when they did know, was told the comparison had expired.
 *
 * So: record which option they chose when they leave, because that is
 * knowable then. Ask what it cost when they return, because that is knowable
 * then. Both halves are on the device, and neither is sent anywhere unless
 * the rider says so.
 *
 * ── Why the window has both ends ───────────────────────────────────────────
 *
 * Too soon and the trip is not over — a fare reported fifteen minutes in is
 * a guess about a ride still happening. Too late and nobody remembers, and a
 * half-remembered figure is worse than no figure, because it enters the
 * corpus looking exactly like a real one.
 *
 * ── Facts at one, statistics at twenty ─────────────────────────────────────
 *
 * A single report is a fact: the estimate contained the fare, or it did not,
 * and the rider can be shown that immediately. An average over three is not
 * a calibration, and `MIN_SAMPLES` is the same threshold the published
 * corpus is held to. The two are different kinds of claim and this file
 * keeps them apart.
 */

import { MIN_SAMPLES, contains, position, type ActualRecord } from "@/lib/eval/metrics";
import type { TripRecord } from "@/lib/history/trip-log";

/**
 * A trip has to be over before its fare is a fact rather than a guess.
 *
 * Twenty-five minutes covers a short city hop with the wait in front of it.
 * A longer trip reported at its true end is still inside the window below.
 */
export const MIN_ELAPSED_MINUTES = 25;

/**
 * Past a week, a remembered fare is a reconstruction. It would enter the
 * corpus indistinguishable from an observed one, which is worse than its
 * absence — and the signed prediction has expired by then anyway.
 */
export const MAX_ELAPSED_DAYS = 7;

/** What the rider is working toward before any statistic is offered. */
export const REPORTS_FOR_ACCURACY = MIN_SAMPLES;

function elapsedMs(record: TripRecord, now: number): number {
  const at = new Date(record.chosen?.at ?? record.at).getTime();
  return Number.isFinite(at) ? now - at : Number.NaN;
}

/**
 * The one trip worth asking about, or none.
 *
 * Only ever one. A page that opens with four questions is a form, and a
 * rider who is asked four things answers none of them.
 */
export function tripAwaitingReport(
  records: readonly TripRecord[],
  now: number = Date.now(),
): TripRecord | null {
  const due = records.filter((r) => {
    if (!r.chosen) return false;
    if (r.outcome) return false;
    if (r.declined) return false;
    const ms = elapsedMs(r, now);
    if (!Number.isFinite(ms)) return false;
    return ms >= MIN_ELAPSED_MINUTES * 60_000 && ms <= MAX_ELAPSED_DAYS * 86_400_000;
  });

  /* The most recent, because it is the one they remember best. */
  due.sort((a, b) => elapsedMs(a, now) - elapsedMs(b, now));
  return due[0] ?? null;
}

/** Record which option the rider tapped through to. */
export function recordChoice(
  records: readonly TripRecord[],
  sessionId: string,
  chosen: TripRecord["chosen"],
): TripRecord[] {
  return records.map((r) => (r.id === sessionId ? { ...r, chosen } : r));
}

/** Record what it actually cost. Kept on the device; sharing is separate. */
export function recordOutcome(
  records: readonly TripRecord[],
  sessionId: string,
  actualMinor: number,
  now: Date = new Date(),
): TripRecord[] {
  return records.map((r) =>
    r.id === sessionId
      ? { ...r, outcome: { actualMinor, at: now.toISOString(), sharedAt: null } }
      : r,
  );
}

/** Note that a contribution reached the corpus, so it is not sent twice. */
export function markShared(
  records: readonly TripRecord[],
  sessionId: string,
  now: Date = new Date(),
): TripRecord[] {
  return records.map((r) =>
    r.id === sessionId && r.outcome
      ? { ...r, outcome: { ...r.outcome, sharedAt: now.toISOString() } }
      : r,
  );
}

/** Never ask about this trip again. */
export function declineReport(records: readonly TripRecord[], sessionId: string): TripRecord[] {
  return records.map((r) => (r.id === sessionId ? { ...r, declined: true } : r));
}

export interface ReportedTrip {
  record: TripRecord;
  /** Was the fare inside the band the rider was shown? */
  contained: boolean;
  /** Signed difference from the nearest edge of the band, in minor units. */
  missedByMinor: number;
  actualMinor: number;
  lowMinor: number;
  highMinor: number;
}

/** Every trip the rider has reported, newest first. */
export function reportedTrips(records: readonly TripRecord[]): ReportedTrip[] {
  return records
    .filter((r): r is TripRecord & { chosen: NonNullable<TripRecord["chosen"]> } =>
      Boolean(r.chosen && r.outcome),
    )
    .map((r) => {
      const { lowMinor, highMinor } = r.chosen;
      const actualMinor = r.outcome!.actualMinor;
      const inside = actualMinor >= lowMinor && actualMinor <= highMinor;
      return {
        record: r,
        contained: inside,
        missedByMinor: inside ? 0 : actualMinor < lowMinor ? actualMinor - lowMinor : actualMinor - highMinor,
        actualMinor,
        lowMinor,
        highMinor,
      };
    })
    .sort((a, b) => new Date(b.record.outcome!.at).getTime() - new Date(a.record.outcome!.at).getTime());
}

export interface PersonalAccuracy {
  /** How many the rider has reported. A fact, available at any n. */
  n: number;
  /** How many more before a statistic is offered. */
  remaining: number;
  /** Null below REPORTS_FOR_ACCURACY — see the header. */
  summary: {
    coverage: number;
    /** Mean signed position in the band: <0.5 means the fare ran low. */
    meanPosition: number;
    /** Mean absolute error against the nearest band edge, in minor units. */
    meanMissMinor: number;
  } | null;
}

/**
 * How the estimate has done for this rider.
 *
 * Deliberately narrow. It reports coverage — did the band contain the fare —
 * and where inside the band fares tended to land, because a band that always
 * contains the fare at its very top is technically right and practically
 * useless. It does not extrapolate, and it says nothing about anyone else.
 */
export function personalAccuracy(records: readonly TripRecord[]): PersonalAccuracy {
  const reports = reportedTrips(records);
  const n = reports.length;
  const remaining = Math.max(0, REPORTS_FOR_ACCURACY - n);
  if (n < REPORTS_FOR_ACCURACY) return { n, remaining, summary: null };

  const asRecords: ActualRecord[] = reports.map((r) => ({
    routeHash: r.record.routeKey,
    provider: r.record.chosen!.provider,
    predictedMinMinor: r.lowMinor,
    predictedMaxMinor: r.highMinor,
    actualMinor: r.actualMinor,
    predictedAt: r.record.at,
  }));

  const covered = asRecords.filter((r) =>
    contains({ min: r.predictedMinMinor, max: r.predictedMaxMinor }, r.actualMinor),
  ).length;

  const positions = asRecords.map((r) =>
    position({ min: r.predictedMinMinor, max: r.predictedMaxMinor }, r.actualMinor),
  );

  return {
    n,
    remaining,
    summary: {
      coverage: covered / n,
      meanPosition: positions.reduce((a, b) => a + b, 0) / n,
      meanMissMinor: reports.reduce((a, r) => a + Math.abs(r.missedByMinor), 0) / n,
    },
  };
}

/** Reports that could be contributed but have not been. */
export function unsharedReports(records: readonly TripRecord[]): TripRecord[] {
  return records.filter(
    (r) => r.outcome && r.outcome.sharedAt === null && r.chosen?.claim && r.chosen?.signature,
  );
}
