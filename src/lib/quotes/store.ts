/**
 * The memory behind the quote cache and the rate limiter.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT A MODULE-LEVEL Map ACTUALLY BUYS YOU ON SERVERLESS                  │
 * │                                                                          │
 * │ Both stores were bare `Map`s at module scope, which has two separate     │
 * │ consequences and they are worth keeping apart:                           │
 * │                                                                          │
 * │ 1. SCOPE. Each serverless instance gets its own Map, so a 30/minute      │
 * │    limit is 30/minute *per instance*. Under a fleet of ten, the real     │
 * │    limit is 300. The cache has the milder version of the same problem:   │
 * │    a miss on a cold instance, which costs latency rather than            │
 * │    correctness.                                                          │
 * │                                                                          │
 * │ 2. LIFETIME. Neither store ever removed a key. The rate limiter filtered │
 * │    expired timestamps out of a bucket and then wrote the empty bucket    │
 * │    back, so every IP that ever called it was retained for the life of    │
 * │    the instance. The cache deleted an entry only if someone happened to  │
 * │    ask for it after it expired — an entry nobody reads again is an entry │
 * │    that is never freed.                                                  │
 * │                                                                          │
 * │ (2) is fixed here: a sweep plus a hard cap with LRU eviction. (1) cannot │
 * │ be fixed in memory at all, which is why this is an interface — a         │
 * │ Supabase- or KV-backed implementation satisfies the same shape and is a  │
 * │ drop-in. Until then the rate limiter is a courtesy, not a control, and   │
 * │ ARCHITECTURE.md says so.                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

export interface StoredEntry<T> {
  /**
   * Epoch milliseconds at which this entry dies. Validity is the half-open
   * interval [written, expiresAt), so a TTL of zero is expired on arrival
   * rather than alive for one instant.
   */
  expiresAt: number;
  value: T;
}

/**
 * The surface a shared backing store would have to satisfy.
 *
 * Deliberately synchronous: the in-memory implementation is, and widening it to
 * promises is the first thing the Supabase/KV version will change. Doing that
 * now would add `await` to every call site for a benefit nothing yet delivers.
 */
export interface TtlStore<T> {
  get(key: string): T | null;
  set(key: string, value: T, ttlMs: number): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export interface MemoryTtlStoreOptions {
  /** Hard ceiling on retained keys. The least recently used go first. */
  maxEntries?: number;
  /** Don't walk the whole map more often than this. */
  sweepIntervalMs?: number;
  /** Injectable for tests; defaults to the wall clock. */
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 5_000;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

/**
 * A bounded, self-sweeping map.
 *
 * No timers: a background interval keeps a serverless instance alive and is
 * invisible when the process is frozen between invocations. Sweeping happens on
 * write, at most once per interval, which is when the map is growing anyway.
 */
export class MemoryTtlStore<T> implements TtlStore<T> {
  private readonly entries = new Map<string, StoredEntry<T>>();
  private readonly maxEntries: number;
  private readonly sweepIntervalMs: number;
  private readonly now: () => number;
  private lastSweep = 0;

  constructor(options: MemoryTtlStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    // Re-insert so Map iteration order doubles as LRU order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.sweepIfDue();
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: this.now() + ttlMs, value });
    this.evictToCap();
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.lastSweep = 0;
  }

  /** Drop everything expired. Exposed for tests and for the admin page. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    this.lastSweep = now;
    return removed;
  }

  private sweepIfDue(): void {
    if (this.now() - this.lastSweep < this.sweepIntervalMs) return;
    this.sweep();
  }

  private evictToCap(): void {
    while (this.entries.size > this.maxEntries) {
      // Map yields in insertion order, and both get() and set() re-insert, so
      // the first key is the least recently used.
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
