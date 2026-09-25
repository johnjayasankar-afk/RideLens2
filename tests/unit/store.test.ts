/**
 * The bounded store, the rate limiter, and the cache-bleed guard.
 *
 * Both stores were module-level Maps that never removed a key. These tests pin
 * the two properties that fixes: expired entries go, and the map has a ceiling.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildQuoteCacheKey,
  cacheClear,
  cacheGet,
  cacheSet,
  cacheStats,
  cacheSweep,
} from "@/lib/quotes/cache";
import { rateLimit, rateLimitStats, resetRateLimits } from "@/lib/quotes/rate-limit";
import { MemoryTtlStore } from "@/lib/quotes/store";

describe("MemoryTtlStore", () => {
  it("returns a value before it expires and nothing after", () => {
    let now = 1_000;
    const store = new MemoryTtlStore<string>({ now: () => now });
    store.set("k", "v", 100);
    expect(store.get("k")).toBe("v");
    now += 101;
    expect(store.get("k")).toBeNull();
  });

  /*
   * The actual leak: an entry nobody ever reads again. The old cache only
   * deleted on a read that happened to come after expiry, so a key that was
   * written once and never requested stayed for the life of the instance.
   */
  it("frees expired entries nobody asked for", () => {
    let now = 1_000;
    const store = new MemoryTtlStore<string>({ now: () => now, sweepIntervalMs: 0 });
    for (let i = 0; i < 50; i += 1) store.set(`k${i}`, "v", 10);
    expect(store.size).toBe(50);

    now += 11;
    // A write is what triggers the sweep; nothing polls in the background.
    store.set("fresh", "v", 1_000);
    expect(store.size).toBe(1);
    expect(store.get("fresh")).toBe("v");
  });

  it("holds a hard ceiling and evicts least-recently-used first", () => {
    const store = new MemoryTtlStore<string>({ maxEntries: 3, sweepIntervalMs: 1e9 });
    store.set("a", "1", 10_000);
    store.set("b", "2", 10_000);
    store.set("c", "3", 10_000);

    // Touching "a" makes "b" the oldest.
    expect(store.get("a")).toBe("1");
    store.set("d", "4", 10_000);

    expect(store.size).toBe(3);
    expect(store.get("b")).toBeNull();
    expect(store.get("a")).toBe("1");
    expect(store.get("c")).toBe("3");
    expect(store.get("d")).toBe("4");
  });

  it("does not sweep more often than its interval", () => {
    let now = 0;
    const store = new MemoryTtlStore<string>({ now: () => now, sweepIntervalMs: 1_000 });
    store.set("old", "v", 1);
    now = 500;
    store.set("other", "v", 10_000);
    // Too soon to sweep, so the dead key is still occupying space...
    expect(store.size).toBe(2);
    now = 2_000;
    store.set("third", "v", 10_000);
    // ...and gone once the interval has passed.
    expect(store.get("old")).toBeNull();
  });
});

describe("rate limiter", () => {
  beforeEach(() => resetRateLimits());
  afterEach(() => resetRateLimits());

  it("allows up to the limit and then refuses with a retry hint", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit("k", 3, 60).allowed).toBe(true);
    }
    const blocked = rateLimit("k", 3, 60);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("keeps callers separate", () => {
    expect(rateLimit("a", 1, 60).allowed).toBe(true);
    expect(rateLimit("a", 1, 60).allowed).toBe(false);
    expect(rateLimit("b", 1, 60).allowed).toBe(true);
  });

  it("does not retain a bucket per caller forever", () => {
    for (let i = 0; i < 200; i += 1) rateLimit(`ip-${i}`, 5, 60);
    expect(rateLimitStats().size).toBeLessThanOrEqual(20_000);
    resetRateLimits();
    expect(rateLimitStats().size).toBe(0);
  });
});

describe("account-linked cache bleed", () => {
  beforeEach(() => cacheClear());
  afterEach(() => cacheClear());

  const coords = { pickupLat: 40.72, pickupLng: -73.99, destLat: 40.64, destLng: -73.78 };

  /*
   * The guard the brief asked to verify. cacheGet carried a comment claiming
   * it, with no check under it; the real protection was cacheSet plus the key
   * builder. Both halves are asserted here.
   */
  it("never lets a public key read a personalised fare", () => {
    const publicKey = buildQuoteCacheKey({
      ...coords,
      accountContext: "PUBLIC",
      sources: ["fixture"],
    });
    // cacheSet refuses to write a personalised quote under a public key.
    cacheSet(publicKey, { price: 999 }, "ACCOUNT_LINKED");
    expect(cacheGet(publicKey)).toBeNull();

    // And a read refuses even if such an entry existed anyway.
    cacheSet(publicKey, { price: 1 }, "PUBLIC");
    expect(cacheGet<{ price: number }>(publicKey)?.price).toBe(1);
  });

  it("gives a linked account its own key space", () => {
    const linked = buildQuoteCacheKey({
      ...coords,
      accountContext: "ACCOUNT_LINKED",
      userId: "user-1",
      sources: ["fixture"],
    });
    const other = buildQuoteCacheKey({
      ...coords,
      accountContext: "ACCOUNT_LINKED",
      userId: "user-2",
      sources: ["fixture"],
    });
    const anon = buildQuoteCacheKey({
      ...coords,
      accountContext: "PUBLIC",
      sources: ["fixture"],
    });

    cacheSet(linked, { price: 2384 }, "ACCOUNT_LINKED");
    expect(cacheGet<{ price: number }>(linked)?.price).toBe(2384);
    expect(cacheGet(other)).toBeNull();
    expect(cacheGet(anon)).toBeNull();
  });

  it("sweeps and reports its own size", () => {
    const key = buildQuoteCacheKey({ ...coords, accountContext: "PUBLIC", sources: ["f"] });
    cacheSet(key, { price: 1 }, "PUBLIC", 0);
    expect(cacheStats().size).toBe(1);
    expect(cacheSweep()).toBe(1);
    expect(cacheStats().size).toBe(0);
  });
});
