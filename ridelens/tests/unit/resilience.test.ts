/** Circuit breaker and in-flight coalescing. */
import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, DEFAULT_CIRCUIT_POLICY } from '@/orchestration/circuit';
import { InFlightRegistry } from '@/orchestration/coalesce';

describe('CircuitBreaker', () => {
  const T = 1_000_000;

  it('stays closed while a source is healthy', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 20; i += 1) {
      expect(cb.attempt('obi', T).allowed).toBe(true);
      cb.recordSuccess('obi');
    }
    expect(cb.state('obi', T)).toBe('CLOSED');
  });

  it('trips after the configured consecutive failures', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < DEFAULT_CIRCUIT_POLICY.failureThreshold; i += 1) {
      expect(cb.attempt('obi', T).allowed).toBe(true);
      cb.recordFailure('obi', T);
    }
    const decision = cb.attempt('obi', T);
    expect(decision.allowed).toBe(false);
    expect(decision.state).toBe('OPEN');
    expect(decision.reason).toMatch(/failed 4 times/);
    expect(decision.retryAfterMs).toBeGreaterThan(0);
  });

  it('fails fast while open, so a dead source costs no wall clock', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i += 1) cb.recordFailure('curb_flow', T);
    const started = Date.now();
    expect(cb.attempt('curb_flow', T).allowed).toBe(false);
    expect(Date.now() - started).toBeLessThan(5);
  });

  it('half-opens after the cooldown and allows exactly one probe', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i += 1) cb.recordFailure('obi', T);
    const later = T + DEFAULT_CIRCUIT_POLICY.cooldownMs + 1;

    expect(cb.state('obi', later)).toBe('HALF_OPEN');
    expect(cb.attempt('obi', later).allowed).toBe(true);
    // A second concurrent probe is refused.
    expect(cb.attempt('obi', later).allowed).toBe(false);
  });

  it('closes again when the probe succeeds', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i += 1) cb.recordFailure('obi', T);
    const later = T + DEFAULT_CIRCUIT_POLICY.cooldownMs + 1;
    cb.attempt('obi', later);
    cb.recordSuccess('obi');
    expect(cb.state('obi', later)).toBe('CLOSED');
    expect(cb.attempt('obi', later).allowed).toBe(true);
  });

  it('re-opens when the probe fails', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i += 1) cb.recordFailure('obi', T);
    const later = T + DEFAULT_CIRCUIT_POLICY.cooldownMs + 1;
    cb.attempt('obi', later);
    cb.recordFailure('obi', later);
    expect(cb.state('obi', later)).toBe('OPEN');
  });

  it('does not compound failures separated by more than the window', () => {
    const cb = new CircuitBreaker();
    cb.recordFailure('obi', T);
    cb.recordFailure('obi', T + 1);
    // A much later failure starts a fresh streak rather than tripping.
    const far = T + DEFAULT_CIRCUIT_POLICY.windowMs + 10_000;
    cb.recordFailure('obi', far);
    expect(cb.state('obi', far)).toBe('CLOSED');
  });

  it('keeps sources independent', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i += 1) cb.recordFailure('obi', T);
    expect(cb.attempt('obi', T).allowed).toBe(false);
    expect(cb.attempt('curb_flow', T).allowed).toBe(true);
  });

  it('reports a snapshot for the admin view', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i += 1) cb.recordFailure('obi', T);
    const snap = cb.snapshot(T);
    expect(snap).toEqual([{ sourceId: 'obi', state: 'OPEN', consecutiveFailures: 4 }]);
  });
});

describe('InFlightRegistry', () => {
  it('shares one upstream call between identical concurrent callers', async () => {
    const registry = new InFlightRegistry<string>();
    const fn = vi.fn(() => new Promise<string>((r) => setTimeout(() => r('value'), 20)));

    const [a, b] = await Promise.all([registry.run('k', fn), registry.run('k', fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a.value).toBe('value');
    expect(b.value).toBe('value');
    // Exactly one of them owns the call; the other joined it.
    expect([a.joined, b.joined].filter(Boolean)).toHaveLength(1);
  });

  it('keeps different keys separate', async () => {
    const registry = new InFlightRegistry<string>();
    const fn = vi.fn(async () => 'v');
    await Promise.all([registry.run('a', fn), registry.run('b', fn)]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('shares a rejection too — it is the same upstream call', async () => {
    const registry = new InFlightRegistry<string>();
    const fn = vi.fn(
      () => new Promise<string>((_, reject) => setTimeout(() => reject(new Error('boom')), 10)),
    );
    const results = await Promise.allSettled([registry.run('k', fn), registry.run('k', fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('releases the slot so a later call runs fresh', async () => {
    const registry = new InFlightRegistry<string>();
    const fn = vi.fn(async () => 'v');
    await registry.run('k', fn);
    expect(registry.size()).toBe(0);
    await registry.run('k', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('releases the slot after a rejection', async () => {
    const registry = new InFlightRegistry<string>();
    await expect(
      registry.run('k', async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(registry.size()).toBe(0);
  });
});

describe('a cache hit has to be worth having', () => {
  it('refuses an entry with almost none of its life left', async () => {
    const { InMemoryQuoteCache, MIN_REMAINING_LIFE } = await import('@/orchestration/cache');
    const cache = new InMemoryQuoteCache();
    const value = {
      sourceId: 'public_rate_card' as const,
      quotes: [],
      providersAttempted: [],
      fetchedAt: new Date(0).toISOString(),
      latencyMs: 1,
      warnings: [],
    };

    const t0 = 1_000_000;
    cache.set('k', value, 120, t0);

    // Fresh, and halfway through: still worth serving.
    expect(cache.get('k', t0)).not.toBeNull();
    expect(cache.get('k', t0 + 60_000)).not.toBeNull();

    // Down to the last fifth: a price that expires while it is being read is
    // worse than one upstream call, so this is treated as a miss.
    const nearDeath = t0 + 120_000 * (1 - MIN_REMAINING_LIFE) + 1;
    expect(cache.get('k', nearDeath)).toBeNull();
    // And it is evicted, not left to be re-tested on every request.
    expect(cache.size()).toBe(0);
  });

  it('still expires normally past the TTL', async () => {
    const { InMemoryQuoteCache } = await import('@/orchestration/cache');
    const cache = new InMemoryQuoteCache();
    const value = {
      sourceId: 'bikeshare_gbfs' as const,
      quotes: [],
      providersAttempted: [],
      fetchedAt: new Date(0).toISOString(),
      latencyMs: 1,
      warnings: [],
    };
    cache.set('k', value, 60, 0);
    expect(cache.get('k', 61_000)).toBeNull();
  });
});
