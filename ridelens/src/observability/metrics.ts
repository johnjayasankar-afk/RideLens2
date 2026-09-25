/**
 * In-process metrics, flushed to api_usage_daily by the repository.
 *
 * Deliberately small: counters and a latency histogram per source. This is
 * cost control and health monitoring, not a product analytics system, and it
 * never records where anyone went.
 */
import type { SourceId } from '@/domain/quote';

export interface SourceMetrics {
  calls: number;
  cacheHits: number;
  errors: number;
  timeouts: number;
  rateLimited: number;
  latenciesMs: number[];
}

const EMPTY = (): SourceMetrics => ({
  calls: 0,
  cacheHits: 0,
  errors: 0,
  timeouts: 0,
  rateLimited: 0,
  latenciesMs: [],
});

class MetricsRegistry {
  private bySource = new Map<SourceId, SourceMetrics>();
  private sessions = 0;
  private rateLimitEvents = 0;

  private get(id: SourceId): SourceMetrics {
    let m = this.bySource.get(id);
    if (!m) {
      m = EMPTY();
      this.bySource.set(id, m);
    }
    return m;
  }

  recordSession(): void {
    this.sessions += 1;
  }

  recordRateLimitEvent(): void {
    this.rateLimitEvents += 1;
  }

  recordCall(
    id: SourceId,
    latencyMs: number,
    outcome: 'ok' | 'error' | 'timeout' | 'rate_limited',
  ): void {
    const m = this.get(id);
    m.calls += 1;
    // Cap the sample so a long-lived process cannot grow unbounded.
    if (m.latenciesMs.length < 1000) m.latenciesMs.push(latencyMs);
    if (outcome === 'error') m.errors += 1;
    if (outcome === 'timeout') m.timeouts += 1;
    if (outcome === 'rate_limited') m.rateLimited += 1;
  }

  recordCacheHit(id: SourceId): void {
    this.get(id).cacheHits += 1;
  }

  snapshot() {
    const sources = [...this.bySource.entries()].map(([sourceId, m]) => {
      const sorted = [...m.latenciesMs].sort((a, b) => a - b);
      return {
        sourceId,
        calls: m.calls,
        cacheHits: m.cacheHits,
        errors: m.errors,
        timeouts: m.timeouts,
        rateLimited: m.rateLimited,
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        successRate: m.calls === 0 ? null : (m.calls - m.errors - m.timeouts) / m.calls,
      };
    });
    const totalCalls = sources.reduce((a, s) => a + s.calls, 0);
    const totalHits = sources.reduce((a, s) => a + s.cacheHits, 0);
    return {
      sessions: this.sessions,
      rateLimitEvents: this.rateLimitEvents,
      cacheHitRate: totalCalls + totalHits === 0 ? null : totalHits / (totalCalls + totalHits),
      sources,
    };
  }

  reset(): void {
    this.bySource.clear();
    this.sessions = 0;
    this.rateLimitEvents = 0;
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx] ?? null;
}

export const metrics = new MetricsRegistry();

/**
 * Estimated spend. Rates are operator-configurable placeholders; a real
 * contract replaces them. Reported as "estimated" everywhere it is shown —
 * we never present a modelled number as a billed amount.
 */
export const ESTIMATED_COST_PER_CALL_USD_CENTS: Readonly<Partial<Record<SourceId, number>>> = {
  obi: 0,
  curb_flow: 0,
  uber_direct: 0,
  lyft_direct: 0,
  empower_direct: 0,
  demo_fixture: 0,
};
