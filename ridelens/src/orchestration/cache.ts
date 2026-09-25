/**
 * Quote cache.
 *
 * Prices move on surge cycles of tens of seconds, so the cache is purely a
 * cost/latency optimisation with a very short TTL — never a substitute for a
 * live fetch. Two rules are load-bearing:
 *
 *  1. The cache key includes the ACCOUNT CONTEXT. A quote produced against a
 *     linked Uber account is that user's price and must never be served to
 *     another user. Account-linked results are not shared-cached at all.
 *  2. Coordinates are quantised into a grid so nearby requests share an entry,
 *     but the grid is fine enough (~11 m) that the fare does not change.
 */
import type { SourceId } from '@/domain/quote';
import type { CanonicalLocation } from '@/location/types';
import { singleton } from '@/lib/singleton';
import type { SourceQuoteResult } from '@/sources/types';

/** 4 decimal places ≈ 11 m. Fine enough that a fare is unchanged. */
const GRID_DP = 4;

export interface CacheKeyParts {
  sourceId: SourceId;
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  accountContext: 'PUBLIC' | 'ACCOUNT_LINKED';
  /** Opaque per-user salt; present only for ACCOUNT_LINKED. */
  accountScope?: string;
  locale: string;
  /**
   * Part of the key because it is part of the price. Chicago and DC both charge
   * per extra passenger, so a party of four must not be served a cached fare
   * that was quoted for one.
   */
  partySize: number;
  /** Set when the trip is priced for a future instant rather than now. */
  departAt?: Date;
}

export function cacheKey(parts: CacheKeyParts): string {
  const p = `${parts.pickup.lat.toFixed(GRID_DP)},${parts.pickup.lng.toFixed(GRID_DP)}`;
  const d = `${parts.destination.lat.toFixed(GRID_DP)},${parts.destination.lng.toFixed(GRID_DP)}`;
  const scope =
    parts.accountContext === 'ACCOUNT_LINKED'
      ? `user:${parts.accountScope ?? 'unknown'}`
      : 'public';
  // A fare for next Tuesday and a fare for now are different answers to
  // different questions, and must never be served for one another.
  const when = parts.departAt ? `@${parts.departAt.toISOString()}` : '';
  return `q:${parts.sourceId}:${scope}:${parts.locale}:p${parts.partySize}${when}:${p}->${d}`;
}

interface Entry {
  value: SourceQuoteResult;
  expiresAt: number;
  /** When it was stored, so a near-dead entry can be recognised as one. */
  storedAt: number;
}

/**
 * How much of an entry's life must remain for it still to be worth serving.
 *
 * A cache hit with four seconds left is worse than a miss. The rider gets a
 * price that expires while they are still reading it — the card greys out, the
 * Book button goes dead, and the only thing that actually happened is that we
 * saved ourselves one upstream call. Below this fraction the entry is treated
 * as absent and refetched.
 *
 * A fifth is deliberately conservative: the taxi rate card caches for two
 * minutes, so the last twenty-four seconds are given up, and GBFS caches for
 * sixty, giving up twelve.
 */
export const MIN_REMAINING_LIFE = 0.2;

export interface QuoteCache {
  get(key: string, now?: number): SourceQuoteResult | null;
  set(key: string, value: SourceQuoteResult, ttlSeconds: number, now?: number): void;
  clear(): void;
  size(): number;
}

/**
 * Per-instance cache. Correct on a single node and safe on many: a miss just
 * costs one upstream call. A shared cache would need the same key discipline.
 */
export class InMemoryQuoteCache implements QuoteCache {
  private store = new Map<string, Entry>();
  private readonly maxEntries: number;

  constructor(maxEntries = 5_000) {
    this.maxEntries = maxEntries;
  }

  get(key: string, now = Date.now()): SourceQuoteResult | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.store.delete(key);
      return null;
    }
    // Nearly dead is dead. Serving the last few seconds of a quote hands the
    // rider a price that expires while they read it.
    const lifetime = hit.expiresAt - hit.storedAt;
    if (lifetime > 0 && (hit.expiresAt - now) / lifetime < MIN_REMAINING_LIFE) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  set(key: string, value: SourceQuoteResult, ttlSeconds: number, now = Date.now()): void {
    // TTL 0 disables caching for that source outright.
    if (ttlSeconds <= 0) return;
    if (this.store.size >= this.maxEntries) {
      // Cheap eviction: drop the oldest insertion.
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expiresAt: now + ttlSeconds * 1000, storedAt: now });
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

export const quoteCache: QuoteCache = singleton(
  'orchestration.quoteCache',
  () => new InMemoryQuoteCache(),
);
