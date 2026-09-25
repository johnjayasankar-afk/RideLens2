/**
 * Quote session engine.
 *
 * Every enabled source is fired concurrently with its own deadline. One slow
 * or failing source can never delay or fail the session — results are emitted
 * as they land, and the session settles into PARTIAL rather than FAILED when
 * some sources succeed.
 *
 * Chain: canonical route -> session -> registry -> circuit check -> coalesced
 * parallel fetch -> schema validation (inside each adapter) -> normalize ->
 * reconcile -> rank.
 *
 * Three resilience layers sit in front of every upstream call:
 *   1. cache        — a recent identical answer
 *   2. coalescing   — an identical call already in flight
 *   3. circuit      — a source that is currently down is skipped instantly
 */
import { newId } from '@/domain/ids';
import { refreshQuoteFreshness } from '@/domain/freshness';
import type {
  NormalizedQuote,
  ProviderId,
  QuoteSession,
  SessionStatus,
  SourceId,
  SourceOutcome,
} from '@/domain/quote';
import { rankQuotes } from '@/domain/ranking';
import { reconcileQuotes } from '@/domain/reconcile';
import type { CanonicalLocation } from '@/location/types';
import { logger } from '@/observability/logger';
import { metrics } from '@/observability/metrics';
import { enabledSources } from '@/sources/registry';
import { SourceError, type QuoteSource, type SourceQuoteResult } from '@/sources/types';
import { cacheKey, quoteCache } from './cache';
import { circuitBreaker } from './circuit';
import { InFlightRegistry } from './coalesce';
import { singleton } from '@/lib/singleton';

/**
 * Shared across requests so two riders searching the same route in the same
 * second cost one upstream call.
 */
const inFlight = singleton(
  'orchestration.inFlight',
  () => new InFlightRegistry<SourceQuoteResult>(),
);

/** Test seam. */
export function resetOrchestrationState(): void {
  inFlight.clear();
  circuitBreaker.reset();
}

export interface RunSessionOptions {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  /** Defaults to 1. Priced only where a city publishes a per-passenger charge. */
  partySize?: number;
  locale?: string;
  timeoutMs: number;
  /** Prices the trip for a future instant rather than now. */
  departAt?: Date;
  /** Bypasses the cache — used by the explicit Refresh action. */
  forceRefresh?: boolean;
  accountScope?: string;
  /** Fired as each source settles, for streaming. */
  onSourceSettled?: (outcome: SourceOutcome, quotes: NormalizedQuote[]) => void;
  signal?: AbortSignal;
}

/**
 * Hard ceiling on a whole session, independent of per-source deadlines. Belt
 * and braces: an adapter that never settles cannot hold a stream open.
 */
const SESSION_DEADLINE_MARGIN_MS = 2_000;

export async function runQuoteSession(opts: RunSessionOptions): Promise<QuoteSession> {
  const sessionId = newId('qs');
  const createdAt = new Date().toISOString();
  const locale = opts.locale ?? 'en-US';
  const sources = enabledSources();

  metrics.recordSession();

  const sourcesExpected = sources.map((s) => s.capabilities().sourceId);

  logger.info('quote_session.start', {
    sessionId,
    sources: sourcesExpected,
    // Route is intentionally absent: no coordinates in logs.
  });

  if (sources.length === 0) {
    return emptySession(sessionId, createdAt, opts);
  }

  const runs = sources.map((source) => runOneSource(source, opts, locale, sessionId));

  // allSettled: an individual rejection never propagates out of the session.
  const settled = await withDeadline(
    Promise.allSettled(runs),
    opts.timeoutMs + SESSION_DEADLINE_MARGIN_MS,
    () =>
      sources.map(() => ({ status: 'rejected' as const, reason: new Error('session deadline') })),
  );

  const outcomes: SourceOutcome[] = [];
  const candidates: NormalizedQuote[] = [];

  settled.forEach((result, i) => {
    const sourceId = sourcesExpected[i] as SourceId;
    if (result.status === 'fulfilled') {
      outcomes.push(result.value.outcome);
      candidates.push(...result.value.quotes);
    } else {
      // Defensive: runOneSource catches everything, so this is only reachable
      // via the session deadline.
      outcomes.push({
        sourceId,
        status: 'TIMEOUT',
        latencyMs: null,
        quoteCount: 0,
        message: 'Source did not settle before the session deadline.',
        blockerCode: null,
        cacheHit: false,
      });
    }
  });

  const now = Date.now();
  const refreshed = candidates.map((q) => refreshQuoteFreshness(q, now));
  const { canonical, discrepancies } = reconcileQuotes(refreshed, { now });
  const ranked = rankQuotes(canonical, 'CHEAPEST');

  const sourcesSucceeded = outcomes.filter((o) => o.status === 'OK').map((o) => o.sourceId);
  const sourcesFailed = outcomes.filter((o) => o.status !== 'OK').map((o) => o.sourceId);
  const providersReturned = Array.from(new Set(ranked.map((q) => q.provider))) as ProviderId[];

  const status = deriveStatus(sourcesSucceeded, sourcesFailed, ranked.length);

  logger.info('quote_session.complete', {
    sessionId,
    status,
    succeeded: sourcesSucceeded,
    failed: sourcesFailed,
    quotes: ranked.length,
    discrepancies: discrepancies.length,
  });

  return {
    id: sessionId,
    status,
    createdAt,
    completedAt: new Date().toISOString(),
    pickup: opts.pickup,
    destination: opts.destination,
    coverage: { sourcesExpected, sourcesSucceeded, sourcesFailed, providersReturned },
    outcomes,
    quotes: ranked,
    candidates: refreshed,
    discrepancies,
  };
}

function emptySession(sessionId: string, createdAt: string, opts: RunSessionOptions): QuoteSession {
  return {
    id: sessionId,
    status: 'FAILED',
    createdAt,
    completedAt: new Date().toISOString(),
    pickup: opts.pickup,
    destination: opts.destination,
    coverage: {
      sourcesExpected: [],
      sourcesSucceeded: [],
      sourcesFailed: [],
      providersReturned: [],
    },
    outcomes: [],
    quotes: [],
    candidates: [],
    discrepancies: [],
  };
}

async function withDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deriveStatus(
  succeeded: SourceId[],
  failed: SourceId[],
  quoteCount: number,
): SessionStatus {
  if (succeeded.length === 0) return 'FAILED';
  if (failed.length > 0) return 'PARTIAL';
  return quoteCount > 0 ? 'SUCCESS' : 'PARTIAL';
}

interface SourceRun {
  outcome: SourceOutcome;
  quotes: NormalizedQuote[];
}

async function runOneSource(
  source: QuoteSource,
  opts: RunSessionOptions,
  locale: string,
  sessionId: string,
): Promise<SourceRun> {
  const caps = source.capabilities();
  const sourceId = caps.sourceId;
  const accountContext = opts.accountScope ? ('ACCOUNT_LINKED' as const) : ('PUBLIC' as const);

  const key = cacheKey({
    sourceId,
    pickup: opts.pickup,
    destination: opts.destination,
    accountContext,
    accountScope: opts.accountScope,
    locale,
    partySize: opts.partySize ?? 1,
    departAt: opts.departAt,
  });

  // ── 1. Cache ───────────────────────────────────────────────────────────
  if (!opts.forceRefresh) {
    const cached = quoteCache.get(key);
    if (cached) {
      metrics.recordCacheHit(sourceId);
      const outcome: SourceOutcome = {
        sourceId,
        status: 'OK',
        latencyMs: cached.latencyMs,
        quoteCount: cached.quotes.length,
        // The cached result's own warnings, exactly as the fresh path reports
        // them. This was `null`, which meant a source that answered "no
        // published rate card for this pickup — here is what is covered" said
        // it once and then, for everyone served from cache, said nothing at
        // all. A route with no prices and no explanation is a dead end, and it
        // is the reply most likely to be cached.
        message: cached.warnings.length > 0 ? cached.warnings.join(' ') : null,
        blockerCode: null,
        cacheHit: true,
      };
      opts.onSourceSettled?.(outcome, cached.quotes);
      return { outcome, quotes: cached.quotes };
    }
  }

  // ── 2. Circuit ─────────────────────────────────────────────────────────
  const decision = circuitBreaker.attempt(sourceId);
  if (!decision.allowed) {
    const outcome: SourceOutcome = {
      sourceId,
      status: 'ERROR',
      latencyMs: 0,
      quoteCount: 0,
      message: decision.reason ?? 'Temporarily skipped.',
      blockerCode: null,
      cacheHit: false,
    };
    logger.warn('quote_source.circuit_open', { sessionId, sourceId, state: decision.state });
    opts.onSourceSettled?.(outcome, []);
    return { outcome, quotes: [] };
  }

  const started = Date.now();

  try {
    // ── 3. Coalesce ──────────────────────────────────────────────────────
    const { value: result, joined } = await inFlight.run(key, () =>
      source.getQuotes({
        sessionId,
        pickup: opts.pickup,
        destination: opts.destination,
        partySize: opts.partySize ?? 1,
        departAt: opts.departAt,
        timeoutMs: opts.timeoutMs,
        locale,
        signal: opts.signal,
      }),
    );

    const latencyMs = Date.now() - started;
    circuitBreaker.recordSuccess(sourceId);
    metrics.recordCall(sourceId, latencyMs, 'ok');

    // Account-linked results are per-user and are never shared-cached.
    if (accountContext === 'PUBLIC' && !joined) {
      quoteCache.set(key, result, caps.cacheTtlSeconds);
    }

    const outcome: SourceOutcome = {
      sourceId,
      status: 'OK',
      latencyMs,
      quoteCount: result.quotes.length,
      message: result.warnings.length > 0 ? result.warnings.join(' ') : null,
      blockerCode: null,
      cacheHit: false,
    };
    opts.onSourceSettled?.(outcome, result.quotes);
    return { outcome, quotes: result.quotes };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const outcome = toOutcome(sourceId, err, latencyMs, source);

    // A deliberately disabled source is configuration, not failure — it must
    // never trip the breaker.
    if (outcome.status !== 'SKIPPED') circuitBreaker.recordFailure(sourceId);

    metrics.recordCall(
      sourceId,
      latencyMs,
      outcome.status === 'TIMEOUT'
        ? 'timeout'
        : outcome.status === 'RATE_LIMITED'
          ? 'rate_limited'
          : 'error',
    );
    logger.warn('quote_source.failed', {
      sessionId,
      sourceId,
      status: outcome.status,
      message: outcome.message,
    });
    // A failed source yields zero quotes. It NEVER yields substitute values.
    opts.onSourceSettled?.(outcome, []);
    return { outcome, quotes: [] };
  }
}

function toOutcome(
  sourceId: SourceId,
  err: unknown,
  latencyMs: number,
  source: QuoteSource,
): SourceOutcome {
  if (err instanceof SourceError) {
    if (err.kind === 'DISABLED') {
      const gate = source.enablement();
      return {
        sourceId,
        status: 'SKIPPED',
        latencyMs: null,
        quoteCount: 0,
        message: gate.blockerMessage,
        blockerCode: gate.blockerCode,
        cacheHit: false,
      };
    }
    const status =
      err.kind === 'TIMEOUT'
        ? 'TIMEOUT'
        : err.kind === 'UNAUTHORIZED'
          ? 'UNAUTHORIZED'
          : err.kind === 'RATE_LIMITED'
            ? 'RATE_LIMITED'
            : 'ERROR';
    return {
      sourceId,
      status,
      latencyMs,
      quoteCount: 0,
      message: err.message,
      blockerCode: null,
      cacheHit: false,
    };
  }
  return {
    sourceId,
    status: 'ERROR',
    latencyMs,
    quoteCount: 0,
    message: err instanceof Error ? err.message : 'Unknown failure',
    blockerCode: null,
    cacheHit: false,
  };
}
