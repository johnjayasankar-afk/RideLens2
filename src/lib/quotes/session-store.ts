/**
 * Where a quote session lives after the request that made it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A MAP IS NOT A STORE WHEN THERE IS MORE THAN ONE INSTANCE                │
 * │                                                                          │
 * │ The orchestrator kept sessions in `const sessions = new Map()`. On       │
 * │ Vercel the next request can land on a different instance, which has its  │
 * │ own empty Map, so /api/quotes/[id] answered "Session not found" for a    │
 * │ session that certainly existed. Everything built on retrieving one —     │
 * │ shared links, the admin's recent list, the reported-actual capture —     │
 * │ worked in development and failed in production at a rate set by how many │
 * │ instances happened to be warm.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Memory stays, as a read-through cache: it is still the fastest answer for
 * the instance that just wrote it, and the only answer when Supabase is not
 * configured. What changes is that a miss now asks the database before giving
 * up.
 *
 * Writes are deliberately not awaited by the request that triggers them. A
 * rider waiting on a comparison should not also wait on a row insert, and a
 * database that is down should cost the session's durability, not the
 * comparison.
 */
import { supabaseConfigured } from "@/lib/config";
import type { QuoteSession } from "@/lib/domain/types";
import { logger } from "@/lib/logger";
import { MemoryTtlStore } from "@/lib/quotes/store";
import { createAdminClient } from "@/lib/supabase/admin";

/** Long enough to open a shared link and report a fare against it. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One cache per process, not one per module graph.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Next compiles route handlers and React Server Components into separate   │
 * │ server graphs, so a module-scope `new MemoryTtlStore()` is constructed   │
 * │ TWICE in one process and neither copy ever sees the other's writes.      │
 * │                                                                          │
 * │ Measured against the running build, on one session id, seconds apart:    │
 * │   GET /api/quotes/<id>        → 200, the whole 16 KB session             │
 * │   GET /c/<id>                 → 200, rendering "This comparison is not   │
 * │                                 here. This deployment has no database…"  │
 * │   GET /c/<id>/opengraph-image → 200, a PNG of the real comparison        │
 * │                                                                          │
 * │ So every link the Share button has ever produced was a dead page under   │
 * │ a correct thumbnail — and the page answers 200, which is why no status   │
 * │ check ever caught it. The OG image works because it is a route handler,  │
 * │ in the same graph as the writer; the page is an RSC, in the other.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `globalThis` is the only scope both graphs share. This does not make a fleet
 * of instances coherent — that is what Supabase is for, and
 * `sessionsAreDurable()` still says so on the page itself — but it makes one
 * process coherent, which is the difference between a share link that works on
 * a single deployment and one that never works anywhere.
 */
interface SessionMemory {
  cache: MemoryTtlStore<QuoteSession>;
  recentIds: string[];
}
const MEMORY_KEY = "__ridelens_session_memory__" as const;
const globalScope = globalThis as typeof globalThis & { [MEMORY_KEY]?: SessionMemory };
const memory: SessionMemory = (globalScope[MEMORY_KEY] ??= {
  /** Bounded, because an instance can live a long time. */
  cache: new MemoryTtlStore<QuoteSession>({ maxEntries: 500 }),
  /** Insertion-ordered ids, so the admin page can list recent work. */
  recentIds: [],
});
const cache = memory.cache;
const recentIds = memory.recentIds;

function remember(session: QuoteSession): void {
  cache.set(session.id, session, SESSION_TTL_MS);
  const at = recentIds.indexOf(session.id);
  if (at !== -1) recentIds.splice(at, 1);
  recentIds.unshift(session.id);
  if (recentIds.length > 200) recentIds.length = 200;
}

function rowToSession(row: Record<string, unknown>): QuoteSession {
  return {
    id: String(row.id),
    status: row.status as QuoteSession["status"],
    pickup: row.pickup as QuoteSession["pickup"],
    destination: row.destination as QuoteSession["destination"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    coverage: (row.coverage ?? {}) as QuoteSession["coverage"],
    quotes: (row.quotes ?? []) as QuoteSession["quotes"],
    discrepancies: (row.discrepancies ?? []) as QuoteSession["discrepancies"],
    rankingMode: (row.ranking_mode ?? "cheapest") as QuoteSession["rankingMode"],
    categoryFilter: (row.category_filter ?? "ALL") as QuoteSession["categoryFilter"],
  };
}

/**
 * Cache it, then durably store it — without making the caller wait.
 *
 * Returns void rather than a promise on purpose: every call site is inside a
 * request that has already produced its answer, and awaiting here would add a
 * database round-trip to a response that does not need one.
 */
export function putSession(session: QuoteSession): void {
  remember(session);
  if (!supabaseConfigured()) return;

  void (async () => {
    try {
      const supabase = createAdminClient();
      const { error } = await supabase.from("quote_sessions").upsert(
        {
          id: session.id,
          status: session.status,
          pickup: session.pickup,
          destination: session.destination,
          ranking_mode: session.rankingMode,
          category_filter: session.categoryFilter,
          coverage: session.coverage,
          quotes: session.quotes,
          discrepancies: session.discrepancies,
          updated_at: session.updatedAt,
          expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        },
        { onConflict: "id" },
      );
      if (error) throw new Error(error.message);
    } catch (err) {
      // A session that failed to persist is still perfectly usable on this
      // instance. Losing it later is worth a log line, not a failed request.
      logger.warn("session_persist_failed", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  })();
}

/**
 * Memory first, then the database.
 *
 * The cold-start case is the whole point: an instance that never ran this
 * comparison can still answer for it.
 */
export async function getSession(id: string): Promise<QuoteSession | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  if (!supabaseConfigured()) return null;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("quote_sessions")
      .select("*")
      .eq("id", id)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const session = rowToSession(data as Record<string, unknown>);
    remember(session);
    return session;
  } catch (err) {
    logger.warn("session_load_failed", {
      sessionId: id,
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

export async function listRecentSessions(limit = 20): Promise<QuoteSession[]> {
  if (supabaseConfigured()) {
    try {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("quote_sessions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      if (data) return (data as Record<string, unknown>[]).map(rowToSession);
    } catch (err) {
      logger.warn("session_list_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  // Memory is the fallback, and the only source when Supabase is absent. It
  // shows this instance's work rather than the fleet's, and the admin page
  // says so.
  return recentIds
    .map((id) => cache.get(id))
    .filter((s): s is QuoteSession => s !== null)
    .slice(0, limit);
}

/** Test seam. */
export function clearSessionCache(): void {
  cache.clear();
  recentIds.length = 0;
}

/** Whether a retrieved session can outlive this instance. */
export function sessionsAreDurable(): boolean {
  return supabaseConfigured();
}
