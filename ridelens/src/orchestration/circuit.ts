/**
 * Per-source circuit breaker.
 *
 * A provider that is down does not become healthy because we keep asking. Left
 * alone, every comparison pays that source's full timeout — 8 seconds of dead
 * wall-clock on every search — and, once a paid contract exists, burns quota on
 * calls that cannot succeed.
 *
 * The breaker trips after consecutive failures, fails fast while open, then
 * lets exactly one probe through to discover recovery.
 *
 *   CLOSED ──(N consecutive failures)──▶ OPEN
 *   OPEN ──(cooldown elapsed)──▶ HALF_OPEN
 *   HALF_OPEN ──(probe ok)──▶ CLOSED   ──(probe fails)──▶ OPEN
 *
 * Deliberately NOT tripped by: a source being disabled (that is configuration,
 * not failure) or returning zero quotes (a real answer meaning "nothing here").
 */
import type { SourceId } from '@/domain/quote';
import { singleton } from '@/lib/singleton';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitPolicy {
  /** Consecutive failures that trip the breaker. */
  failureThreshold: number;
  /** How long to stay open before allowing a probe. */
  cooldownMs: number;
  /** Failures older than this no longer count toward the threshold. */
  windowMs: number;
}

export const DEFAULT_CIRCUIT_POLICY: CircuitPolicy = {
  failureThreshold: 4,
  cooldownMs: 30_000,
  windowMs: 120_000,
};

interface Entry {
  consecutiveFailures: number;
  lastFailureAt: number;
  openedAt: number | null;
  /** True while a half-open probe is in flight, so only one is allowed. */
  probing: boolean;
}

export interface CircuitDecision {
  allowed: boolean;
  state: CircuitState;
  /** Present when the call is refused. */
  reason?: string;
  retryAfterMs?: number;
}

export class CircuitBreaker {
  private entries = new Map<SourceId, Entry>();

  constructor(private readonly policy: CircuitPolicy = DEFAULT_CIRCUIT_POLICY) {}

  private entry(id: SourceId): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { consecutiveFailures: 0, lastFailureAt: 0, openedAt: null, probing: false };
      this.entries.set(id, e);
    }
    return e;
  }

  state(id: SourceId, now = Date.now()): CircuitState {
    const e = this.entry(id);
    if (e.openedAt === null) return 'CLOSED';
    return now - e.openedAt >= this.policy.cooldownMs ? 'HALF_OPEN' : 'OPEN';
  }

  /** Ask before dispatching. A refusal is instant, so a dead source costs nothing. */
  attempt(id: SourceId, now = Date.now()): CircuitDecision {
    const e = this.entry(id);
    const state = this.state(id, now);

    if (state === 'CLOSED') return { allowed: true, state };

    if (state === 'OPEN') {
      const retryAfterMs = Math.max(0, this.policy.cooldownMs - (now - (e.openedAt ?? now)));
      return {
        allowed: false,
        state,
        reason: `Skipped: this source failed ${e.consecutiveFailures} times in a row. Retrying in ${Math.ceil(retryAfterMs / 1000)}s.`,
        retryAfterMs,
      };
    }

    // HALF_OPEN — exactly one probe at a time.
    if (e.probing) {
      return { allowed: false, state, reason: 'Skipped: a recovery probe is already in flight.' };
    }
    e.probing = true;
    return { allowed: true, state };
  }

  recordSuccess(id: SourceId): void {
    const e = this.entry(id);
    e.consecutiveFailures = 0;
    e.openedAt = null;
    e.probing = false;
  }

  recordFailure(id: SourceId, now = Date.now()): void {
    const e = this.entry(id);
    e.probing = false;

    // A failure long after the last one starts a fresh streak rather than
    // compounding with ancient history.
    if (e.lastFailureAt !== 0 && now - e.lastFailureAt > this.policy.windowMs) {
      e.consecutiveFailures = 0;
    }
    e.consecutiveFailures += 1;
    e.lastFailureAt = now;

    if (e.consecutiveFailures >= this.policy.failureThreshold) e.openedAt = now;
  }

  snapshot(now = Date.now()): Array<{
    sourceId: SourceId;
    state: CircuitState;
    consecutiveFailures: number;
  }> {
    return [...this.entries.entries()].map(([sourceId, e]) => ({
      sourceId,
      state: this.state(sourceId, now),
      consecutiveFailures: e.consecutiveFailures,
    }));
  }

  reset(): void {
    this.entries.clear();
  }
}

export const circuitBreaker = singleton('orchestration.circuitBreaker', () => new CircuitBreaker());
