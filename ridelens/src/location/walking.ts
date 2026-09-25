/**
 * How long it actually takes to walk to the platform.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A SECOND ROUTER, AND NOT THE ONE ALREADY HERE                        │
 * │                                                                          │
 * │ `routing.ts` talks to the public OSRM demo server, which serves ONE      │
 * │ profile: the car. It accepts `/route/v1/walking/` and `/route/v1/foot/`  │
 * │ in the path and answers with the driving graph anyway — measured, for    │
 * │ the Loop to Chicago Union Station: 2132 m in 248 s, which is 31 km/h.    │
 * │ Asking it for a walk and believing the answer would have turned a        │
 * │ twenty-minute walk into a four-minute one and made the product's most    │
 * │ prominent claim far worse than the straight-line estimate it replaced.   │
 * │                                                                          │
 * │ So walking gets its own client, pointed at a router that really does     │
 * │ have a pedestrian graph. The same leg, through Valhalla's `pedestrian`   │
 * │ costing: 1815 m in 1349 s — 1.35 m/s, and 1.28× the straight line, which │
 * │ is what a grid city with a river through it should cost on foot.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Failure is non-fatal and never silent. When the router does not answer, the
 * caller falls back to a straight-line estimate and the UI says "about" in
 * different words, because a guess and a measurement are not the same claim.
 */
import { singleton } from '@/lib/singleton';
import { httpJson } from '@/sources/http';
import { getConfig } from '@/config/env';
import { logger } from '@/observability/logger';
import { distanceMeters, type Point } from '@/domain/geo';

/**
 * The public Valhalla instance run by FOSSGIS on OpenStreetMap data. Keyless,
 * and intended — like the OSRM demo this project already uses for the map — for
 * development and light use. An operator carrying real traffic should self-host
 * or buy a routing service and point WALKING_BASE_URL at it; nothing else
 * changes, because the shape below is Valhalla's documented public one.
 */
const DEFAULT_WALKING_HOST = 'valhalla1.openstreetmap.de';

/**
 * A walk is a short request and a slow one is worth abandoning: the straight-
 * line fallback is already reasonable, and a rider waiting on a fare should not
 * wait on a footpath.
 */
const TIMEOUT_MS = 3_500;

/**
 * Beyond this nobody is walking, so there is nothing to measure.
 *
 * Station matching reaches 8 km, which is a sensible radius for "there is a
 * railway near you" and an absurd one for "you will stroll to it". Asking a
 * pedestrian router to cost a five-mile hike burns a request to produce a
 * number no one would act on.
 */
export const WALKABLE_METERS = 2_000;

export interface WalkMeasurement {
  /** Metres along a footpath, not across the rooftops. */
  meters: number;
  seconds: number;
}

/**
 * Where a walking figure came from, because the two are different claims.
 *
 * ROUTED is a measured path on a pedestrian graph. ESTIMATED is straight-line
 * distance at a planning pace — honest, and systematically short, because
 * streets do not go where the crow flies. On the leg this module was written
 * for, the estimate undershoots the measurement by a quarter.
 */
export type WalkBasis = 'ROUTED' | 'ESTIMATED';

/** The ordinary planning pace for an unhurried adult, about 3 mph. */
export const WALK_METERS_PER_SECOND = 1.35;

export interface Walk extends WalkMeasurement {
  basis: WalkBasis;
}

/**
 * Footpaths are not fares.
 *
 * The quote cache lives for tens of seconds because a surge price does. A
 * pavement changes on the timescale of a construction project, so the same walk
 * can be answered from memory for hours — which is the difference between one
 * request per rail quote and one per rider. The first cut had no cache at all
 * and put two calls to a public instance on the critical path of every rail
 * fare; the live E2E suite, which prices the same four trips dozens of times,
 * is what made that obvious.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Bounded so a long-lived process cannot grow a map without end. */
const CACHE_MAX_ENTRIES = 2_000;

/** 4 decimal places ≈ 11 m, the same grid the quote cache quantises on. */
const GRID_DP = 4;

interface CacheEntry {
  value: WalkMeasurement | null;
  expiresAt: number;
}

function walkCache(): Map<string, CacheEntry> {
  return singleton('walking.cache', () => new Map<string, CacheEntry>());
}

/**
 * Requests in flight, so two riders asking for the same walk at the same moment
 * make one call rather than two. Rail quotes arrive in bursts, and the burst is
 * exactly when politeness to a shared public instance matters most.
 */
function inFlight(): Map<string, Promise<WalkMeasurement | null>> {
  return singleton('walking.inflight', () => new Map<string, Promise<WalkMeasurement | null>>());
}

function cacheKey(from: Point, to: Point): string {
  const q = (n: number) => n.toFixed(GRID_DP);
  return `${q(from.lat)},${q(from.lng)}>${q(to.lat)},${q(to.lng)}`;
}

function walkingHost(): string {
  const configured = getConfig().WALKING_BASE_URL;
  if (!configured) return DEFAULT_WALKING_HOST;
  try {
    return new URL(configured).hostname;
  } catch {
    return DEFAULT_WALKING_HOST;
  }
}

interface ValhallaResponse {
  trip?: {
    summary?: { length?: number; time?: number };
  };
}

/**
 * Measure one walk, or return null and let the caller estimate.
 *
 * Never throws: every failure mode here — the router being down, slow,
 * rate-limiting us, or answering with something unrecognisable — has the same
 * correct handling, which is to fall back to the estimate rather than to fail
 * a fare that is otherwise perfectly good.
 */
export async function fetchWalk(from: Point, to: Point): Promise<WalkMeasurement | null> {
  const key = cacheKey(from, to);
  const cache = walkCache();
  const hit = cache.get(key);
  if (hit !== undefined && hit.expiresAt > Date.now()) return hit.value;

  const pending = inFlight().get(key);
  if (pending !== undefined) return pending;

  const request = fetchWalkUncached(from, to)
    // fetchWalkUncached swallows its own failures, but a rejection here would
    // otherwise strand the in-flight entry and wedge this key forever.
    .catch(() => null)
    .then((value) => {
      // A failure is cached too, briefly, so a router that is down does not get
      // hammered once per rail quote while it recovers.
      const ttl = value === null ? 60_000 : CACHE_TTL_MS;
      if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(key, { value, expiresAt: Date.now() + ttl });
      inFlight().delete(key);
      return value;
    });
  inFlight().set(key, request);
  return request;
}

async function fetchWalkUncached(from: Point, to: Point): Promise<WalkMeasurement | null> {
  const host = walkingHost();
  const body = {
    locations: [
      { lat: from.lat, lon: from.lng },
      { lat: to.lat, lon: to.lng },
    ],
    costing: 'pedestrian',
    // Ask for no turn-by-turn prose. We want two numbers, and the narrative is
    // the bulk of the payload.
    directions_type: 'none',
    units: 'kilometers',
  };

  try {
    const url = new URL(`https://${host}/route`);
    url.searchParams.set('json', JSON.stringify(body));

    const data = await httpJson<ValhallaResponse>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [host],
      maxBytes: 256 * 1024,
    });

    const summary = data.trip?.summary;
    const km = summary?.length;
    const seconds = summary?.time;
    if (typeof km !== 'number' || typeof seconds !== 'number') return null;
    if (!Number.isFinite(km) || !Number.isFinite(seconds) || seconds <= 0) return null;

    return { meters: km * 1000, seconds };
  } catch (err) {
    logger.warn('walking.failed', {
      host,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

/**
 * The straight-line fallback, stated as what it is.
 *
 * Distance across the rooftops at a planning pace. It is the number this
 * product shipped before there was a pedestrian router, and it is kept because
 * an approximate walk stated as approximate beats no walk at all — which is
 * what the alternative amounts to, since a trip whose access is unstated reads
 * as a trip with no access.
 */
export function estimateWalk(from: Point, to: Point): Walk {
  const meters = distanceMeters(from, to);
  return {
    meters,
    seconds: meters / WALK_METERS_PER_SECOND,
    basis: 'ESTIMATED',
  };
}

/**
 * Measure the walk if it is worth measuring, and estimate it otherwise.
 *
 * The order matters: the straight line decides whether to spend a request,
 * because it is a lower bound on the walk. If the crow cannot make it in two
 * kilometres then neither can anybody on foot, and the exact figure for a hike
 * nobody will take is not worth a round trip.
 */
export async function measureWalk(from: Point, to: Point): Promise<Walk> {
  const estimate = estimateWalk(from, to);
  if (estimate.meters > WALKABLE_METERS) return estimate;

  const routed = await fetchWalk(from, to);
  if (routed === null) return estimate;

  /*
   * A routed walk shorter than the straight line between its endpoints is
   * geometrically impossible, so the router has snapped an endpoint somewhere
   * unhelpful. Trust the estimate rather than publish a measurement that
   * cannot be true.
   */
  if (routed.meters < estimate.meters * 0.95) return estimate;

  return { ...routed, basis: 'ROUTED' };
}
