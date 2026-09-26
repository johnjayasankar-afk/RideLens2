/**
 * Different data goes stale at different speeds.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Everything in this app shared one 12-second TTL, and the only thing      │
 * │ actually being cached was the finished quote session. The two slowest    │
 * │ things in a comparison — an OSRM route and an Open-Meteo reading — were  │
 * │ fetched from scratch every single time, from public servers, on the      │
 * │ critical path.                                                           │
 * │                                                                          │
 * │ Roads do not move. A route between two fixed points is the same answer   │
 * │ an hour later. Caching it for twelve seconds is close to not caching it. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── Why the quote class stays short ────────────────────────────────────────
 *
 * The marketplace simulation ticks on ~55 seconds and the product's whole
 * claim is that the number moves with it. A long quote TTL would serve a
 * price from a tick that has passed while the card says "5 sec ago", which
 * is the freshness label lying — a worse failure than a slow page.
 *
 * ── Why routes get stale-while-revalidate and nothing else does ────────────
 *
 * Serving a slightly old route means serving a distance and duration that
 * were true an hour ago and are almost certainly still true. Serving a
 * slightly old price means showing a fare that has moved. The first is a
 * latency win with no honesty cost; the second is the thing this codebase
 * exists not to do.
 */

import { MemoryTtlStore } from "@/lib/quotes/store";

export type DataClass = "route" | "weather" | "geocode" | "quote";

/** How long an answer is simply correct. */
export const TTL_SECONDS: Record<DataClass, number> = {
  /* Roads do not move. Bounded by tolls and closures changing, not traffic —
     traffic lives in the marketplace model, not in the route. */
  route: 6 * 60 * 60,
  /* Precipitation is the only weather signal used and it turns over fast. */
  weather: 10 * 60,
  /* An address resolves to the same point tomorrow. */
  geocode: 24 * 60 * 60,
  /* One marketplace tick is ~55s; this stays comfortably inside it. */
  quote: 12,
};

/**
 * How long past its TTL an answer may still be served, while a fresh one is
 * fetched behind it. Zero means never.
 */
export const STALE_WHILE_REVALIDATE_SECONDS: Record<DataClass, number> = {
  route: 24 * 60 * 60,
  weather: 0,
  geocode: 7 * 24 * 60 * 60,
  /* Never for a price. See the header. */
  quote: 0,
};

interface Entry<T> {
  value: T;
  /** Epoch ms when this became stale. */
  staleAt: number;
}

/*
 * One store per class, so a flood of geocodes cannot evict every route.
 * Sized by how much each entry costs: routes carry a full polyline.
 */
const CAPS: Record<DataClass, number> = {
  route: 500,
  weather: 200,
  geocode: 2_000,
  quote: 1_000,
};

const stores = new Map<DataClass, MemoryTtlStore<Entry<unknown>>>();

function storeFor(cls: DataClass): MemoryTtlStore<Entry<unknown>> {
  let s = stores.get(cls);
  if (!s) {
    s = new MemoryTtlStore<Entry<unknown>>({ maxEntries: CAPS[cls] });
    stores.set(cls, s);
  }
  return s;
}

/** In-flight loads, so ten concurrent misses make one request, not ten. */
const inFlight = new Map<string, Promise<unknown>>();

export interface CachedResult<T> {
  value: T;
  /** Where it came from, for logging and for tests. */
  source: "fresh" | "hit" | "stale";
}

/**
 * Read through the cache for a class, loading on a miss.
 *
 * A thrown load is never cached — a failed OSRM call must not poison the
 * route for six hours. If a stale value exists and the refresh fails, the
 * stale value is kept and returned: an hour-old route beats no route.
 */
export async function cached<T>(
  cls: DataClass,
  key: string,
  load: () => Promise<T>,
): Promise<CachedResult<T>> {
  const store = storeFor(cls);
  const full = `${cls}:${key}`;
  const now = Date.now();
  const entry = store.get(full) as Entry<T> | null;

  if (entry && now < entry.staleAt) {
    return { value: entry.value, source: "hit" };
  }

  const ttlMs = TTL_SECONDS[cls] * 1000;
  const swrMs = STALE_WHILE_REVALIDATE_SECONDS[cls] * 1000;

  const refresh = (): Promise<T> => {
    const existing = inFlight.get(full) as Promise<T> | undefined;
    if (existing) return existing;

    const p = load()
      .then((value) => {
        store.set(full, { value, staleAt: Date.now() + ttlMs }, (ttlMs + swrMs) / 1000);
        return value;
      })
      .finally(() => {
        inFlight.delete(full);
      });
    inFlight.set(full, p);
    return p;
  };

  /*
   * Stale but inside the revalidate window: answer now, refresh behind. The
   * caller waits for nothing.
   */
  if (entry && swrMs > 0) {
    void refresh().catch(() => {
      /* Keep the stale value. An hour-old route beats no route. */
    });
    return { value: entry.value, source: "stale" };
  }

  return { value: await refresh(), source: "fresh" };
}

/** For tests and for the admin page. */
export function dataCacheStats(): Record<DataClass, { size: number; ttlSeconds: number }> {
  const out = {} as Record<DataClass, { size: number; ttlSeconds: number }>;
  for (const cls of Object.keys(TTL_SECONDS) as DataClass[]) {
    out[cls] = { size: storeFor(cls).size, ttlSeconds: TTL_SECONDS[cls] };
  }
  return out;
}

/** Tests only. */
export function clearDataCache(): void {
  for (const s of stores.values()) s.clear();
  inFlight.clear();
}
