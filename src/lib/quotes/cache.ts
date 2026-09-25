import { getEnv } from "@/lib/config";
import type { AccountContext } from "@/lib/domain/types";
import { MemoryTtlStore } from "@/lib/quotes/store";

interface CacheEntry<T> {
  value: T;
  accountContext: AccountContext;
}

/**
 * Bounded and self-sweeping — see store.ts. Quote payloads are the largest
 * thing this process holds, so the cap is lower than the default.
 */
const store = new MemoryTtlStore<CacheEntry<unknown>>({ maxEntries: 1_000 });

export function buildQuoteCacheKey(input: {
  pickupLat: number;
  pickupLng: number;
  destLat: number;
  destLng: number;
  accountContext: AccountContext;
  userId?: string;
  sources: string[];
  rankingMode?: string;
  categoryFilter?: string;
}): string {
  const round = (n: number) => n.toFixed(5);
  const userPart =
    input.accountContext === "ACCOUNT_LINKED" && input.userId ? `u:${input.userId}` : "public";
  const filterPart = input.categoryFilter ?? "standard";
  const modePart = input.rankingMode ?? "cheapest";
  return [
    round(input.pickupLat),
    round(input.pickupLng),
    round(input.destLat),
    round(input.destLng),
    input.accountContext,
    userPart,
    [...input.sources].sort().join(","),
    modePart,
    typeof filterPart === "string" ? filterPart : JSON.stringify(filterPart),
  ].join("|");
}

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;

  /*
   * This check used to be a comment saying it happened, directly above a bare
   * return. The only thing standing between a personalised fare and another
   * rider was cacheSet's refusal to write, plus the fact that the key builder
   * puts the account context and the user id into the key — real protection,
   * but entirely upstream, so nothing here could have caught a malformed key.
   * Now the read refuses too.
   */
  if (entry.accountContext === "ACCOUNT_LINKED" && key.includes("|public")) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet<T>(
  key: string,
  value: T,
  accountContext: AccountContext,
  ttlSeconds?: number,
): void {
  const env = getEnv();
  // Never put ACCOUNT_LINKED quotes in a shared public cache key
  if (accountContext === "ACCOUNT_LINKED" && key.includes("|public")) {
    return;
  }
  store.set(key, { value, accountContext }, (ttlSeconds ?? env.QUOTE_CACHE_TTL_SECONDS) * 1000);
}

export function cacheClear(): void {
  store.clear();
}

export function cacheStats() {
  return { size: store.size };
}

/** Drop expired entries now. Used by the admin page and by tests. */
export function cacheSweep(): number {
  return store.sweep();
}
