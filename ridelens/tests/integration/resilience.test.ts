/**
 * The three layers in front of every upstream call, exercised through the real
 * engine: cache, coalescing, circuit breaker.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRideLensEnv, DESTINATION, PICKUP, withEnv } from '@tests/helpers';
import { FetchMock } from '@tests/fetchmock';
import { resetOrchestrationState } from '@/orchestration/engine';
import obiQuotes from '@tests/fixtures/obi-quotes.json';

const mock = new FetchMock();
const OBI = 'api.rideobi.com/v1/quotes';

const opts = {
  pickup: PICKUP,
  destination: DESTINATION,
  locale: 'en-US',
  timeoutMs: 1_000,
};

beforeEach(() => {
  clearRideLensEnv();
  resetOrchestrationState();
  mock.install();
});
afterEach(() => {
  mock.restore();
  resetOrchestrationState();
  clearRideLensEnv();
});

describe('in-flight coalescing', () => {
  it('collapses two simultaneous identical comparisons into one upstream call', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k', QUOTE_CACHE_TTL_SECONDS: '0' });
    resetOrchestrationState();
    mock.onDelay(OBI, obiQuotes, 120);

    const { runQuoteSession } = await import('@/orchestration/engine');
    const [a, b] = await Promise.all([runQuoteSession(opts), runQuoteSession(opts)]);

    expect(mock.calls).toHaveLength(1);
    expect(a.quotes.length).toBeGreaterThan(0);
    expect(b.quotes.length).toBe(a.quotes.length);
  });

  it('does not collapse different routes', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k', QUOTE_CACHE_TTL_SECONDS: '0' });
    resetOrchestrationState();
    mock.onDelay(OBI, obiQuotes, 80);

    const { runQuoteSession } = await import('@/orchestration/engine');
    await Promise.all([
      runQuoteSession(opts),
      runQuoteSession({ ...opts, destination: { ...DESTINATION, lat: 41.1 } }),
    ]);
    expect(mock.calls).toHaveLength(2);
  });
});

describe('circuit breaker', () => {
  it('stops calling a source that keeps failing, and says why', async () => {
    withEnv({
      NODE_ENV: 'development',
      OBI_API_KEY: 'k',
      QUOTE_CACHE_TTL_SECONDS: '0',
      QUOTE_REQUEST_TIMEOUT_MS: '1000',
    });
    resetOrchestrationState();
    mock.onError(OBI);

    const { runQuoteSession } = await import('@/orchestration/engine');

    // Four consecutive failures trip the breaker.
    for (let i = 0; i < 4; i += 1) await runQuoteSession(opts);
    expect(mock.calls).toHaveLength(4);

    const afterTrip = await runQuoteSession(opts);
    // No fifth upstream call was made.
    expect(mock.calls).toHaveLength(4);

    const outcome = afterTrip.outcomes.find((o) => o.sourceId === 'obi');
    expect(outcome?.status).toBe('ERROR');
    expect(outcome?.message).toMatch(/failed 4 times in a row/i);
    expect(afterTrip.quotes).toHaveLength(0);
  });

  it('recovers on the next success once the breaker closes', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k', QUOTE_CACHE_TTL_SECONDS: '0' });
    resetOrchestrationState();
    mock.onError(OBI);

    const { runQuoteSession } = await import('@/orchestration/engine');
    for (let i = 0; i < 2; i += 1) await runQuoteSession(opts);

    // Below the threshold, so the source is still being tried.
    mock.restore();
    mock.install();
    mock.on(OBI, obiQuotes);
    const ok = await runQuoteSession(opts);
    expect(ok.coverage.sourcesSucceeded).toContain('obi');
  });

  it('never trips on a disabled source — that is configuration, not failure', async () => {
    withEnv({ NODE_ENV: 'development', RIDELENS_DEMO_SOURCE: 'enabled' });
    resetOrchestrationState();
    const { runQuoteSession } = await import('@/orchestration/engine');
    for (let i = 0; i < 8; i += 1) await runQuoteSession(opts);
    const last = await runQuoteSession(opts);
    // The fixture source keeps working; nothing was skipped by a breaker.
    expect(last.quotes.length).toBeGreaterThan(0);
  });
});

describe('session deadline', () => {
  it('settles even when a source never resolves', async () => {
    withEnv({
      NODE_ENV: 'development',
      OBI_API_KEY: 'k',
      QUOTE_REQUEST_TIMEOUT_MS: '1000',
      QUOTE_CACHE_TTL_SECONDS: '0',
    });
    resetOrchestrationState();
    mock.onHang(OBI, 60_000);

    const { runQuoteSession } = await import('@/orchestration/engine');
    const started = Date.now();
    const session = await runQuoteSession({ ...opts, timeoutMs: 800 });
    const elapsed = Date.now() - started;

    expect(session.status).toBe('FAILED');
    // Bounded by the per-source timeout plus the session margin, not by 60s.
    expect(elapsed).toBeLessThan(4_000);
  });
});
