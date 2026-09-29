/**
 * A journey time, from an engine that read a schedule.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ types.ts has said since it was written that a journey time is absent     │
 * │ because "there is no schedule source wired up here". This is the source. │
 * │ It does not change that standard — it meets it. A number arrives with    │
 * │ the engine that computed it and the instant it was computed, the way a   │
 * │ fare arrives with the page it was read off and the date it was read.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Written against OpenTripPlanner's `/plan` contract rather than one vendor's
 * client, so the engine is configuration rather than code: a hosted
 * OTP-compatible endpoint today, an OTP you run yourself later, no code
 * change either way.
 *
 * Every failure is an absence. No key, no network, a 500, a body that is not
 * JSON, a body that is JSON but not a plan, no route found, a duration that is
 * a string or negative or longer than a day, a timeout — all of them return
 * null, which types.ts already calls "a first-class result. A source that
 * guesses is worse than one that declines." This module must never throw into
 * a request path, and never print its credential: auth is a query parameter,
 * so an error that quoted the URL would put a key in a log line.
 */

import { getEnv, transitRoutingConfigured } from "@/lib/config";
import { cached } from "@/lib/quotes/data-cache";

export interface MeasuredJourney {
  /** Whole seconds, as the engine reported them. Never rounded to look tidy. */
  seconds: number;
  /** ISO instant the query ran. A schedule answer ages in minutes, so it is dated. */
  measuredAt: string;
  /** The engine, named, for the line under the figure. */
  label: string;
  /** Its terms page, or null for an engine you host yourself. */
  url: string | null;
}

const PLAN_PATH = "/otp/plan";

/** Shorter than the walking lookup's: nobody is blocked on this row. */
const TIMEOUT_MS = 4000;

/**
 * Past this, the answer is malformed rather than long.
 *
 * A bound that can only ever cause an absence is safe; one that clamped a
 * figure into range would be inventing. Six hours is far beyond any journey
 * inside the area alternatives.ts serves.
 */
const MAX_PLAUSIBLE_SECONDS = 6 * 60 * 60;

/**
 * OTP wants a *local* date and time, and this server is not in New York.
 *
 * Hardcoded because the app is: tariffs.ts prices the MTA and alternatives.ts
 * knows three airports. A second city would make this a parameter.
 */
const ZONE = "America/New_York";

/** Some engines ask for a contactable agent; everyone else deserves one. */
const USER_AGENT = "RideLens/0.1 (+https://ridelens.app)";

/**
 * The caller's signal *and* our deadline, never one instead of the other.
 *
 * osrm.ts writes `signal ?? AbortSignal.timeout(…)`, which silently drops the
 * timeout the moment a caller passes a signal. The deadline is the one
 * guarantee this module cannot afford to lose, so it survives even where
 * `AbortSignal.any` does not exist.
 */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Local wall-clock date and time in the zone above. */
export function localDateAndTime(now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    /* h23, not hour12:false — some ICU builds render midnight as 24. */
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

/**
 * Both published shapes, and nothing else.
 *
 * OTP nests itineraries under `plan`; some compatible engines put them at the
 * top level. Accepting either is reading two documented formats, not guessing
 * at one.
 */
function itinerariesIn(body: unknown): unknown[] | null {
  if (typeof body !== "object" || body === null) return null;
  const top = (body as { itineraries?: unknown }).itineraries;
  if (Array.isArray(top)) return top;
  const plan = (body as { plan?: unknown }).plan;
  if (typeof plan !== "object" || plan === null) return null;
  const nested = (plan as { itineraries?: unknown }).itineraries;
  return Array.isArray(nested) ? nested : null;
}

/**
 * The fastest itinerary the engine actually returned, or null.
 *
 * The minimum rather than the first: both are real journeys the engine found,
 * but OTP returns a Pareto set whose ordering is not contractual, and "the
 * fastest one it found" is a claim that survives the engine changing its sort.
 */
export function shortestItinerarySeconds(body: unknown): number | null {
  const itineraries = itinerariesIn(body);
  if (itineraries == null) return null;

  let best: number | null = null;
  for (const entry of itineraries) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = (entry as { duration?: unknown }).duration;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const seconds = Math.round(raw);
    if (seconds <= 0 || seconds > MAX_PLAUSIBLE_SECONDS) continue;
    if (best == null || seconds < best) best = seconds;
  }
  return best;
}

/**
 * Who to credit, derived from the host rather than assumed.
 *
 * A hosted service's terms generally require its name and a link. An engine
 * somebody runs themselves gets named honestly and linked nowhere, because
 * there is nothing to link to.
 */
function provenanceFor(base: string): { label: string; url: string | null } {
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (host === "transit.land" || host.endsWith(".transit.land")) {
      return { label: "Transitland routing", url: "https://www.transit.land/terms" };
    }
    return { label: `Transit routing (${host})`, url: null };
  } catch {
    return { label: "Transit routing", url: null };
  }
}

/** Implements the `TransitRoutingSource` seam declared in types.ts. */
export class OtpJourneyTimeSource {
  readonly id = "otp-plan";

  configured(): boolean {
    /* getEnv() throws on a malformed URL. Being unconfigured is not a crash. */
    try {
      return transitRoutingConfigured();
    } catch {
      return false;
    }
  }

  /** The figure and where it came from. Null is an answer, not an error. */
  async journey(
    pickup: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    signal?: AbortSignal,
  ): Promise<MeasuredJourney | null> {
    try {
      const env = getEnv();
      const base = env.TRANSIT_ROUTING_BASE_URL;
      /* Nothing configured: return before a URL exists, let alone a request. */
      if (!base) return null;

      const { date, time } = localDateAndTime(new Date());
      const url = new URL(`${base.replace(/\/+$/, "")}${PLAN_PATH}`);
      url.searchParams.set("fromPlace", `${pickup.lat},${pickup.lng}`);
      url.searchParams.set("toPlace", `${destination.lat},${destination.lng}`);
      url.searchParams.set("date", date);
      url.searchParams.set("time", time);
      if (env.TRANSIT_ROUTING_API_KEY) {
        url.searchParams.set("api_key", env.TRANSIT_ROUTING_API_KEY);
      }

      const res = await fetch(url, {
        signal: withTimeout(signal, TIMEOUT_MS),
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!res.ok) return null;

      const seconds = shortestItinerarySeconds(await res.json());
      if (seconds == null) return null;

      const { label, url: attribution } = provenanceFor(base);
      return { seconds, measuredAt: new Date().toISOString(), label, url: attribution };
    } catch {
      /*
       * Swallowed whole, and deliberately not logged. The URL in scope carries
       * the key in a query parameter, and an error message that quoted it
       * would put a credential in a log line. A journey time nobody could
       * compute is simply absent, which is what the panel already says.
       */
      return null;
    }
  }

  async durationSeconds(
    pickup: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    signal?: AbortSignal,
  ): Promise<number | null> {
    return (await this.journey(pickup, destination, signal))?.seconds ?? null;
  }
}

export const otpJourneyTimeSource = new OtpJourneyTimeSource();

/**
 * The cached read, which is what routes should call.
 *
 * Two callers want this answer for the same trip — the panel and the
 * assistant's brief — so they share a key and the second one costs nothing.
 * A null is cached too: on a metered tier, a service that is failing should be
 * asked four times an hour, not once per request.
 *
 * Rounded to ~110 m rather than osrm.ts's ~11 m. A transit journey measured in
 * tens of minutes does not change between two ends of a block, and the coarser
 * key is the difference between a shared answer and a spent quota.
 */
export async function measuredJourneyFor(
  pickup: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<MeasuredJourney | null> {
  if (!otpJourneyTimeSource.configured()) return null;
  const key = [pickup.lat, pickup.lng, destination.lat, destination.lng]
    .map((n) => n.toFixed(3))
    .join(",");
  try {
    const { value } = await cached("transit", key, () =>
      otpJourneyTimeSource.journey(pickup, destination, signal),
    );
    return value;
  } catch {
    return null;
  }
}
