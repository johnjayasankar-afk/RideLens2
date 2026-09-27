/**
 * What this trip has cost you before.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Every comparison was a one-shot. You ran it, you read it, it was gone.   │
 * │ Nothing in the product remembered that you price the same airport run    │
 * │ twice a week, and so nothing could tell you the thing you actually want  │
 * │ to know: is $46 a lot, for this?                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A model cannot answer that. It has no memory and no ground truth — it can
 * only tell you what it thinks the fare is right now, which is the number you
 * are already looking at. But *you* have seen this route before, and what you
 * saw is a real observation. Kept, it becomes the only honest form of context
 * this product can offer: not "prices are usually lower on Tuesday", which
 * would be the model talking to itself, but "the six times you have looked,
 * the cheapest option ran $18 to $34."
 *
 * ── The rules this file exists to enforce ──────────────────────────────────
 *
 * **It never leaves the device.** There is no endpoint, no sync, no id. The
 * log is a private record and the UI says so.
 *
 * **Bands stay bands.** A record stores the low and the high it was shown. It
 * never stores a midpoint, because a midpoint is a number nobody was ever
 * quoted — the same rule the rest of the app is held to.
 *
 * **Model versions are never pooled.** A record carries the MODEL_VERSION
 * that produced it. Records from an older model describe a different
 * estimator, and averaging across them would be inventing a series that no
 * single model ever produced. They are counted and named, not silently mixed.
 *
 * **No statistic below a stated n.** `historyForRoute` returns null rather
 * than summarising two observations, and whatever it does return carries its
 * own sample size so the caller cannot quietly drop it.
 *
 * **Nothing here predicts.** Every figure is descriptive and past-tense. The
 * forecast lives in departure-window.ts, says so, and is a different claim.
 */

import type { ConfidenceClass, ProviderId, QuoteSession, QuoteType } from "@/lib/domain/types";
/* Type-only: report-proof.ts reaches for node:crypto, and this file runs
   in the browser. The import is erased at compile time. */
import type { PredictionClaim } from "@/lib/eval/report-proof";

/** Bumped when the stored shape changes; older records are dropped, not guessed at. */
export const TRIP_LOG_VERSION = 1;

/** Enough to cover months of real use, small enough to stay under the quota. */
export const MAX_RECORDS = 200;

/**
 * Past this, a record describes a market that has moved on — fuel, fleet size
 * and rate cards all change. An old observation is not evidence about today.
 */
export const MAX_AGE_DAYS = 180;

/**
 * Two observations are an anecdote. Below this the answer is "not enough
 * times yet", which is a true and useful thing to say.
 */
export const MIN_SAMPLES_FOR_RANGE = 3;

/** How precisely two pickups must agree to count as the same trip: ~110m. */
const ROUTE_KEY_PRECISION = 3;

export interface LoggedEndpoint {
  lat: number;
  lng: number;
  label: string;
}

export interface LoggedQuote {
  provider: ProviderId;
  product: string;
  /** The band as shown. For a point quote, low === high. Never a midpoint. */
  lowMinor: number;
  highMinor: number;
  type: QuoteType;
  confidence: ConfidenceClass;
}

/**
 * The option the rider actually tapped through to.
 *
 * Recorded at the handoff, which is the moment this is knowable — unlike the
 * fare, which is not knowable for another half hour. Without it there is no
 * way to ask a useful question later: "what did it cost?" needs to know
 * which of six options is being asked about.
 */
export interface ChosenOption {
  quoteId: string;
  provider: ProviderId;
  product: string;
  /** The band as shown, so the question can state what was predicted. */
  lowMinor: number;
  highMinor: number;
  at: string;
  /**
   * The prediction, signed by the server that made it.
   *
   * Carried so the rider can report the fare days later, once the session
   * that produced it is long gone. Absent when the deployment has no
   * `RIDELENS_REPORT_SECRET`, in which case the report stays on the device.
   */
  claim?: PredictionClaim;
  signature?: string;
}

/** What the trip actually cost, once the rider has said. */
export interface ReportedOutcome {
  actualMinor: number;
  at: string;
  /**
   * When this was contributed to the shared calibration corpus, or null if
   * it was kept on the device. Contributing is always a separate, explicit
   * act — the local record is private and the corpus is not.
   */
  sharedAt: string | null;
}

export interface TripRecord {
  v: number;
  /** The session this came from, so a re-render cannot log the same run twice. */
  id: string;
  at: string;
  from: LoggedEndpoint;
  to: LoggedEndpoint;
  routeKey: string;
  miles: number | null;
  minutes: number | null;
  quotes: LoggedQuote[];
  /** Records from different model versions are counted apart, never pooled. */
  modelVersion: string;

  /*
   * Everything below is optional and was added after v1 shipped. Optional
   * additions do not need a version bump: an older record simply lacks them,
   * and every reader here treats absence as "not known", which is true.
   */

  /** Set when the rider tapped through to a provider. */
  chosen?: ChosenOption;
  /** Set when the rider said what it cost. */
  outcome?: ReportedOutcome;
  /** Set when the rider declined to say, so they are never asked twice. */
  declined?: boolean;
}

/**
 * A stable identity for "the same trip".
 *
 * Rounded rather than exact, because two taps on the same corner produce
 * coordinates that differ in the sixth decimal and a rider would call those
 * one trip. Direction is kept: a run to the airport is not the run home, and
 * they price differently.
 */
export function routeKeyFor(from: LoggedEndpoint, to: LoggedEndpoint): string {
  const r = (n: number) => n.toFixed(ROUTE_KEY_PRECISION);
  return `${r(from.lat)},${r(from.lng)}>${r(to.lat)},${r(to.lng)}`;
}

function shortLabel(address: string, name?: string): string {
  const first = (name || address).split(",")[0]?.trim();
  return first && first.length > 0 ? first : address;
}

/**
 * Turn a finished comparison into a record, or refuse.
 *
 * A session with no priced option records nothing — an empty comparison is
 * not an observation that this trip cost anything.
 */
export function toRecord(session: QuoteSession, modelVersion: string): TripRecord | null {
  const priced = session.quotes.filter(
    (q) => q.availability !== "UNAVAILABLE" && Number.isFinite(q.priceMinMinor),
  );
  if (priced.length === 0) return null;

  const from: LoggedEndpoint = {
    lat: session.pickup.lat,
    lng: session.pickup.lng,
    label: shortLabel(session.pickup.formattedAddress, session.pickup.name),
  };
  const to: LoggedEndpoint = {
    lat: session.destination.lat,
    lng: session.destination.lng,
    label: shortLabel(session.destination.formattedAddress, session.destination.name),
  };

  /* Distance and duration are properties of the route, so any quote that
     carries them carries the same ones. */
  const withRoute = priced.find((q) => q.distanceMeters != null);
  const withTime = priced.find((q) => q.tripDurationSeconds != null);

  return {
    v: TRIP_LOG_VERSION,
    id: session.id,
    at: session.createdAt,
    from,
    to,
    routeKey: routeKeyFor(from, to),
    miles: withRoute?.distanceMeters != null ? withRoute.distanceMeters / 1609.344 : null,
    minutes: withTime?.tripDurationSeconds != null ? withTime.tripDurationSeconds / 60 : null,
    quotes: priced.map((q) => ({
      provider: q.provider,
      product: q.providerProductName,
      lowMinor: q.priceMinMinor,
      highMinor: q.priceMaxMinor,
      type: q.priceType,
      confidence: q.confidenceClass,
    })),
    modelVersion,
  };
}

/** Drop what is too old, or written by a shape this build no longer reads. */
export function pruneRecords(records: readonly TripRecord[], now = Date.now()): TripRecord[] {
  const cutoff = now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return records
    .filter((r) => r && r.v === TRIP_LOG_VERSION)
    .filter((r) => {
      const t = new Date(r.at).getTime();
      return Number.isFinite(t) && t >= cutoff && t <= now + 60_000;
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_RECORDS);
}

/**
 * Add one record.
 *
 * Keyed on the session id so that a component re-rendering, a stream
 * delivering a second event for the same session, or a refresh that reuses
 * the session cannot turn one comparison into three observations. An inflated
 * n is worse than no n.
 */
export function addRecord(
  records: readonly TripRecord[],
  record: TripRecord,
  now = Date.now(),
): TripRecord[] {
  const withoutDuplicate = records.filter((r) => r.id !== record.id);
  return pruneRecords([record, ...withoutDuplicate], now);
}

export interface RecentTrip {
  routeKey: string;
  from: LoggedEndpoint;
  to: LoggedEndpoint;
  lastAt: string;
  /** How many times this exact trip has been compared, within the log. */
  times: number;
}

/**
 * The trips worth offering again: most recent first, one row per route.
 *
 * Collapsed by route rather than listed by comparison, because six runs of
 * the same commute is one thing a rider wants back, not six.
 */
export function recentTrips(records: readonly TripRecord[], limit = 6): RecentTrip[] {
  const byRoute = new Map<string, RecentTrip>();
  for (const r of records) {
    const existing = byRoute.get(r.routeKey);
    if (existing) {
      existing.times += 1;
      if (new Date(r.at).getTime() > new Date(existing.lastAt).getTime()) existing.lastAt = r.at;
      continue;
    }
    byRoute.set(r.routeKey, {
      routeKey: r.routeKey,
      from: r.from,
      to: r.to,
      lastAt: r.at,
      times: 1,
    });
  }
  return [...byRoute.values()]
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
    .slice(0, limit);
}

export interface RouteHistory {
  routeKey: string;
  /** Observations pooled into the figures below. Never below MIN_SAMPLES_FOR_RANGE. */
  n: number;
  /** The lowest low and the highest high the cheapest option has shown. */
  cheapestLowMinor: number;
  cheapestHighMinor: number;
  firstAt: string;
  lastAt: string;
  /** Which providers have actually come out cheapest, and how often. */
  winners: Array<{ provider: ProviderId; times: number }>;
  /**
   * Records left out because a different model version produced them. Named
   * rather than dropped quietly — the reader is entitled to know the log
   * holds more than the summary counted.
   */
  excludedOtherModel: number;
}

/**
 * The rule for "the cheapest option", exported because today's comparison has
 * to be measured by it too.
 *
 * If the log summarised on the lowest low and the panel compared today's
 * midpoint against it, the standing would be wrong in a direction nobody
 * would notice — every fresh comparison would read dearer than it was. One
 * definition, used on both sides of the comparison.
 *
 * Bands are compared on their lows: the low is the only number in a band
 * that was actually quoted at, and it is the one the ranking uses.
 */
export function cheapestLowMinor(quotes: readonly { lowMinor: number }[]): number | null {
  let low = Infinity;
  for (const q of quotes) if (q.lowMinor < low) low = q.lowMinor;
  return Number.isFinite(low) ? low : null;
}

/** The cheapest option itself, picked by the same rule as `cheapestLowMinor`. */
function cheapestOf(record: TripRecord): LoggedQuote | null {
  const low = cheapestLowMinor(record.quotes);
  if (low === null) return null;
  return record.quotes.find((q) => q.lowMinor === low) ?? null;
}

/**
 * What this route has actually cost, in the reader's own observations.
 *
 * Returns null below MIN_SAMPLES_FOR_RANGE. That is the point: a range drawn
 * from two looks is not a range, and the honest answer — "you have only
 * compared this twice" — is one the caller should have to say out loud.
 *
 * Pools only records from `modelVersion`. A figure spanning two estimators is
 * a figure no estimator ever produced.
 */
export function historyForRoute(
  records: readonly TripRecord[],
  routeKey: string,
  modelVersion: string,
): RouteHistory | null {
  const onRoute = records.filter((r) => r.routeKey === routeKey);
  const sameModel = onRoute.filter((r) => r.modelVersion === modelVersion);
  if (sameModel.length < MIN_SAMPLES_FOR_RANGE) return null;

  let low = Infinity;
  let high = -Infinity;
  const winnerCounts = new Map<ProviderId, number>();

  for (const r of sameModel) {
    const cheapest = cheapestOf(r);
    if (!cheapest) continue;
    if (cheapest.lowMinor < low) low = cheapest.lowMinor;
    if (cheapest.highMinor > high) high = cheapest.highMinor;
    winnerCounts.set(cheapest.provider, (winnerCounts.get(cheapest.provider) ?? 0) + 1);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

  const times = [...sameModel].map((r) => new Date(r.at).getTime()).sort((a, b) => a - b);

  return {
    routeKey,
    n: sameModel.length,
    cheapestLowMinor: low,
    cheapestHighMinor: high,
    firstAt: new Date(times[0]).toISOString(),
    lastAt: new Date(times[times.length - 1]).toISOString(),
    winners: [...winnerCounts.entries()]
      .map(([provider, t]) => ({ provider, times: t }))
      .sort((a, b) => b.times - a.times),
    excludedOtherModel: onRoute.length - sameModel.length,
  };
}

/**
 * Where today's cheapest sits against what this route has cost before.
 *
 * Deliberately narrow. It answers "is this one of the cheaper looks I have
 * had" and refuses anything stronger: no trend, no advice about waiting, no
 * claim that tomorrow will differ. Those would be predictions, and a log of
 * past observations cannot support one.
 */
export type StandingLabel =
  "cheapest_seen" | "below_usual" | "in_range" | "above_usual" | "dearest_seen";

export function standingAgainstHistory(
  todayLowMinor: number,
  history: RouteHistory,
): { label: StandingLabel; text: string } {
  const { cheapestLowMinor: low, cheapestHighMinor: high, n } = history;
  const span = high - low;

  if (todayLowMinor <= low) {
    return { label: "cheapest_seen", text: `The lowest you have seen in ${n} looks` };
  }
  if (todayLowMinor >= high) {
    return { label: "dearest_seen", text: `The highest you have seen in ${n} looks` };
  }
  /* A flat span makes thirds meaningless; everything is simply in range. */
  if (span <= 0) return { label: "in_range", text: `In line with your ${n} previous looks` };

  const position = (todayLowMinor - low) / span;
  if (position < 1 / 3)
    return { label: "below_usual", text: `Toward the low end of your ${n} looks` };
  if (position > 2 / 3)
    return { label: "above_usual", text: `Toward the high end of your ${n} looks` };
  return { label: "in_range", text: `About the middle of your ${n} looks` };
}
