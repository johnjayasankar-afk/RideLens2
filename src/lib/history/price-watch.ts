/**
 * "Tell me if this trip drops below $40."
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The obvious shape of this feature is a push notification, and that is    │
 * │ the one thing it must not pretend to be. Delivering one means a server   │
 * │ polling a route on somebody's behalf, a subscription endpoint, and a     │
 * │ channel to send on — none of which exist, and the first of which would   │
 * │ mean generating fares nobody asked for.                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So a watch here is a standing question, answered when the reader next
 * looks. That is genuinely useful — somebody who prices the same run twice a
 * week gets told the moment they open it — and it is describable in one
 * sentence that is entirely true: *checked when you open RideLens, not in the
 * background.*
 *
 * The UI says that sentence. Nothing in this file, and nothing that renders
 * it, may use the words "alert", "notify" or "watch you" in a way that
 * implies otherwise.
 *
 * ── Why the threshold is compared against the low ──────────────────────────
 *
 * A band of $38–$46 against a $40 watch is a trip you can sometimes get for
 * less than $40. Comparing the midpoint would answer a question nobody
 * asked, and comparing the high would refuse a fare that is genuinely
 * available. The low is the number that was actually quoted at, and it is
 * what `cheapestLowMinor` returns for the log.
 */

import { cheapestLowMinor, routeKeyFor, type LoggedEndpoint } from "@/lib/history/trip-log";

/** Bumped when the stored shape changes; older watches are dropped. */
export const PRICE_WATCH_VERSION = 1;

/** More than this and the list stops being a list. */
export const MAX_WATCHES = 12;

/**
 * A watch nobody has looked at in this long has almost certainly been
 * forgotten, and a stale one firing months later is noise rather than news.
 */
export const MAX_WATCH_AGE_DAYS = 90;

export interface PriceWatch {
  v: number;
  /** The route this is about. */
  routeKey: string;
  from: LoggedEndpoint;
  to: LoggedEndpoint;
  /** Fire when the cheapest option's low is at or below this. */
  thresholdMinor: number;
  createdAt: string;
}

export function makeWatch(
  from: LoggedEndpoint,
  to: LoggedEndpoint,
  thresholdMinor: number,
  now = new Date(),
): PriceWatch {
  return {
    v: PRICE_WATCH_VERSION,
    routeKey: routeKeyFor(from, to),
    from,
    to,
    thresholdMinor,
    createdAt: now.toISOString(),
  };
}

export function pruneWatches(watches: readonly PriceWatch[], now = Date.now()): PriceWatch[] {
  const cutoff = now - MAX_WATCH_AGE_DAYS * 24 * 60 * 60 * 1000;
  return watches
    .filter((w) => w && w.v === PRICE_WATCH_VERSION && Number.isFinite(w.thresholdMinor))
    .filter((w) => {
      const t = new Date(w.createdAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .slice(0, MAX_WATCHES);
}

/** One watch per route: a second on the same trip replaces the first. */
export function upsertWatch(
  watches: readonly PriceWatch[],
  watch: PriceWatch,
  now = Date.now(),
): PriceWatch[] {
  return pruneWatches([watch, ...watches.filter((w) => w.routeKey !== watch.routeKey)], now);
}

export function removeWatch(watches: readonly PriceWatch[], routeKey: string): PriceWatch[] {
  return watches.filter((w) => w.routeKey !== routeKey);
}

export function watchForRoute(watches: readonly PriceWatch[], routeKey: string): PriceWatch | null {
  return watches.find((w) => w.routeKey === routeKey) ?? null;
}

export interface WatchResult {
  watch: PriceWatch;
  met: boolean;
  /** The figure compared, so the UI never has to recompute it differently. */
  cheapestLowMinor: number;
  /** How far under, when met. Never negative. */
  underByMinor: number;
}

/**
 * Answer the standing question against a comparison that just arrived.
 *
 * Pure, and it stays that way. An earlier draft stamped a `lastMetAt` so the
 * UI could say "again" rather than "now" — a field nothing read, which had
 * to be written from somewhere during a render that was only ever asking a
 * question. Asking is reading. Nothing here records.
 */
export function evaluateWatch(
  watch: PriceWatch,
  quotes: readonly { lowMinor: number }[],
): WatchResult | null {
  const low = cheapestLowMinor(quotes);
  if (low === null) return null;
  return {
    watch,
    met: low <= watch.thresholdMinor,
    cheapestLowMinor: low,
    underByMinor: Math.max(0, watch.thresholdMinor - low),
  };
}

/**
 * The only sentence allowed to describe what a watch does.
 *
 * Exported so the UI cannot quietly invent a better-sounding one, and
 * asserted by a test that refuses "notify", "alert" and "background".
 */
export const WATCH_DISCLOSURE =
  "Checked when you open RideLens — nothing runs in the background and nothing is sent to you.";

/**
 * A starting threshold, offered so nobody has to invent one.
 *
 * Ten per cent below what the trip costs right now, rounded down to a whole
 * currency unit. Proportional rather than a flat amount because "$5 off" is
 * a rounding error on an airport run and a quarter of a short hop.
 *
 * It is a suggestion in an editable field, not a default that gets saved
 * behind anyone's back — a watch nobody chose the number for is a watch
 * nobody meant.
 */
export function suggestThresholdMinor(cheapestLowMinor: number): number {
  const tenPercentOff = cheapestLowMinor * 0.9;
  const wholeUnits = Math.floor(tenPercentOff / 100) * 100;
  return Math.max(100, wholeUnits);
}
