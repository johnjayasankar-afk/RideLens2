import { getEnv } from "@/lib/config";
import type { AccountContext } from "@/lib/domain/types";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  accountContext: AccountContext;
}

const store = new Map<string, CacheEntry<unknown>>();

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
    input.accountContext === "ACCOUNT_LINKED" && input.userId
      ? `u:${input.userId}`
      : "public";
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
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  // Never serve account-linked cache to public key space (belt & suspenders)
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
  store.set(key, {
    value,
    accountContext,
    expiresAt: Date.now() + (ttlSeconds ?? env.QUOTE_CACHE_TTL_SECONDS) * 1000,
  });
}

export function cacheClear(): void {
  store.clear();
}

export function cacheStats() {
  return { size: store.size };
}
