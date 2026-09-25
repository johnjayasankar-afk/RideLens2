/**
 * A session has to outlive the instance that made it.
 *
 * The orchestrator kept sessions in a module-level Map, so on Vercel a request
 * routed elsewhere got "Session not found" for a session that certainly
 * existed. Shared links, the admin's recent list and the reported-actual
 * capture all depend on retrieving one, and all of them worked in development
 * and failed in production at a rate set by how many instances were warm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/lib/config";
import type { QuoteSession } from "@/lib/domain/types";

const session = (over: Partial<QuoteSession> = {}): QuoteSession =>
  ({
    id: "11111111-2222-3333-4444-555555555555",
    status: "SUCCESS",
    pickup: { lat: 40.72, lng: -73.99, formattedAddress: "14 Prince St" },
    destination: { lat: 40.64, lng: -73.78, formattedAddress: "JFK" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    coverage: {
      sourcesExpected: ["public_rate_card"],
      sourcesSucceeded: ["public_rate_card"],
      sourcesFailed: [],
      providersReturned: ["uber"],
      providersUnavailable: [],
    },
    quotes: [],
    discrepancies: [],
    rankingMode: "cheapest",
    categoryFilter: "ALL",
    ...over,
  }) as QuoteSession;

/** Stands in for the table, so the read-through path can be exercised. */
function fakeSupabase() {
  const rows = new Map<string, Record<string, unknown>>();
  const client = {
    from() {
      return {
        upsert(row: Record<string, unknown>) {
          rows.set(String(row.id), row);
          return Promise.resolve({ error: null });
        },
        select() {
          const q = {
            _id: null as string | null,
            eq(_col: string, value: string) {
              q._id = value;
              return q;
            },
            gt() {
              return q;
            },
            order() {
              return q;
            },
            limit(n: number) {
              return Promise.resolve({ data: [...rows.values()].slice(0, n), error: null });
            },
            maybeSingle() {
              return Promise.resolve({
                data: q._id ? (rows.get(q._id) ?? null) : null,
                error: null,
              });
            },
          };
          return q;
        },
      };
    },
  };
  return { client, rows };
}

let store: typeof import("@/lib/quotes/session-store");
let fake: ReturnType<typeof fakeSupabase>;

beforeEach(async () => {
  vi.resetModules();
  fake = fakeSupabase();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  resetEnvCache();
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => fake.client,
    createAnonClient: () => fake.client,
  }));
  store = await import("@/lib/quotes/session-store");
  store.clearSessionCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/supabase/admin");
  resetEnvCache();
});

/** Everything this process remembers is gone; the database is not. */
function coldStart() {
  store.clearSessionCache();
}

describe("a session survives a cold start", () => {
  it("is readable from an instance that never wrote it", async () => {
    const s = session();
    store.putSession(s);
    // putSession writes durably without blocking; let the write settle.
    await vi.waitFor(() => expect(fake.rows.size).toBe(1));

    coldStart();

    const found = await store.getSession(s.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(s.id);
    expect(found!.pickup.formattedAddress).toBe("14 Prince St");
  });

  it("round-trips the quotes, not just the envelope", async () => {
    const s = session({
      quotes: [{ id: "q1", provider: "uber", priceMinMinor: 2384 }] as never,
      discrepancies: [{ provider: "uber" }] as never,
    });
    store.putSession(s);
    await vi.waitFor(() => expect(fake.rows.size).toBe(1));
    coldStart();

    const found = await store.getSession(s.id);
    // The table stored only the envelope before this; a row that cannot
    // reconstruct what the rider saw is not a persisted session.
    expect(found!.quotes).toHaveLength(1);
    expect(found!.discrepancies).toHaveLength(1);
    expect(found!.rankingMode).toBe("cheapest");
  });

  it("answers from memory without touching the database", async () => {
    const s = session();
    store.putSession(s);
    const spy = vi.spyOn(fake.client, "from");
    const found = await store.getSession(s.id);
    expect(found!.id).toBe(s.id);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null for a session that never existed", async () => {
    expect(await store.getSession("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("reports itself durable when persistence is configured", () => {
    expect(store.sessionsAreDurable()).toBe(true);
  });
});

describe("without Supabase", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    resetEnvCache();
    store = await import("@/lib/quotes/session-store");
    store.clearSessionCache();
  });

  /*
   * Degrading to the previous behaviour is correct; claiming durability that
   * does not exist is not. The admin page reads this to say which it has.
   */
  it("still serves from memory and admits it is not durable", async () => {
    const s = session();
    store.putSession(s);
    expect((await store.getSession(s.id))!.id).toBe(s.id);
    expect(store.sessionsAreDurable()).toBe(false);

    store.clearSessionCache();
    expect(await store.getSession(s.id)).toBeNull();
  });

  it("lists what this instance has seen", async () => {
    store.putSession(session({ id: "aaaaaaaa-0000-0000-0000-000000000001" }));
    store.putSession(session({ id: "aaaaaaaa-0000-0000-0000-000000000002" }));
    const recent = await store.listRecentSessions(10);
    expect(recent).toHaveLength(2);
    // Most recent first.
    expect(recent[0]!.id).toBe("aaaaaaaa-0000-0000-0000-000000000002");
  });
});
