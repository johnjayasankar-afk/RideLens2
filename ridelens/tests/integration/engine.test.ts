/**
 * Orchestration: concurrency, failure isolation and the no-substitution rule.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRideLensEnv, DESTINATION, PICKUP, withEnv } from '@tests/helpers';
import { FetchMock } from '@tests/fetchmock';
import obiQuotes from '@tests/fixtures/obi-quotes.json';
import curbQuotes from '@tests/fixtures/curb-quotes.json';

const mock = new FetchMock();

/**
 * Host-qualified so Obi's "/v1/quotes" cannot also match Curb's
 * "/flow/v1/quotes" — a bare path substring silently hijacks the wrong source.
 */
const OBI = 'api.rideobi.com/v1/quotes';
const CURB = 'api.gocurb.com/flow/v1/quotes';

const opts = {
  pickup: PICKUP,
  destination: DESTINATION,
  locale: 'en-US',
  timeoutMs: 1_200,
};

beforeEach(() => {
  clearRideLensEnv();
  mock.install();
});
afterEach(() => {
  mock.restore();
  clearRideLensEnv();
});

describe('runQuoteSession', () => {
  it('queries every enabled source concurrently, not serially', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k', CURB_API_KEY: 'k' });
    // Each source takes ~200 ms. Serial would be ~400 ms; parallel ~200 ms.
    mock.onDelay(OBI, obiQuotes, 200).onDelay(CURB, curbQuotes, 200);

    const { runQuoteSession } = await import('@/orchestration/engine');
    const started = Date.now();
    const session = await runQuoteSession(opts);
    const elapsed = Date.now() - started;

    expect(session.coverage.sourcesSucceeded).toHaveLength(2);
    expect(elapsed).toBeLessThan(380);
  });

  it('isolates a failing source: Obi times out, Curb still renders', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k', CURB_API_KEY: 'k' });
    mock.onHang(OBI).on(CURB, curbQuotes);

    const { runQuoteSession } = await import('@/orchestration/engine');
    const session = await runQuoteSession(opts);

    expect(session.status).toBe('PARTIAL');
    expect(session.coverage.sourcesSucceeded).toEqual(['curb_flow']);
    expect(session.coverage.sourcesFailed).toEqual(['obi']);
    expect(session.coverage.providersReturned).toEqual(['curb']);

    // Curb's quotes are present and real.
    expect(session.quotes.length).toBeGreaterThan(0);
    expect(session.quotes.every((q) => q.provider === 'curb')).toBe(true);

    // Nothing was substituted for Uber, Lyft or Empower.
    for (const provider of ['uber', 'lyft', 'empower'] as const) {
      expect(session.quotes.some((q) => q.provider === provider)).toBe(false);
    }

    const obiOutcome = session.outcomes.find((o) => o.sourceId === 'obi');
    expect(obiOutcome?.status).toBe('TIMEOUT');
    expect(obiOutcome?.quoteCount).toBe(0);
  });

  it('reports FAILED, with zero quotes, when every source fails', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k', CURB_API_KEY: 'k' });
    mock.onError(OBI).onError(CURB);

    const { runQuoteSession } = await import('@/orchestration/engine');
    const session = await runQuoteSession(opts);

    expect(session.status).toBe('FAILED');
    expect(session.quotes).toHaveLength(0);
    expect(session.outcomes.every((o) => o.status === 'ERROR')).toBe(true);
  });

  it('returns FAILED with no sources rather than throwing', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { runQuoteSession } = await import('@/orchestration/engine');
    const session = await runQuoteSession(opts);
    expect(session.status).toBe('FAILED');
    expect(session.coverage.sourcesExpected).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });

  it('emits each source as it settles, for progressive rendering', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k', CURB_API_KEY: 'k' });
    mock.on(OBI, obiQuotes).on(CURB, curbQuotes);

    const settled: string[] = [];
    const { runQuoteSession } = await import('@/orchestration/engine');
    await runQuoteSession({
      ...opts,
      onSourceSettled: (outcome) => settled.push(`${outcome.sourceId}:${outcome.status}`),
    });

    expect(settled).toContain('obi:OK');
    expect(settled).toContain('curb_flow:OK');
    expect(settled).toHaveLength(2);
  });

  it('reconciles duplicate providers into one row per product', async () => {
    withEnv({
      NODE_ENV: 'development',
      OBI_API_KEY: 'k',
      UBER_SERVER_TOKEN: 'srv',
      UBER_COMPARISON_RIGHTS_GRANTED: 'true',
    });
    mock
      .on('/v1/quotes', obiQuotes)
      .on('/v1.2/estimates/price', {
        prices: [
          {
            product_id: 'a1111c8c-c720-46c3-8534-2fcdd730040d',
            display_name: 'UberX',
            low_estimate: 38,
            high_estimate: 41,
            currency_code: 'USD',
            duration: 1980,
            distance: 16.5,
          },
        ],
      })
      .on('/v1.2/estimates/time', { times: [] });

    const { runQuoteSession } = await import('@/orchestration/engine');
    const session = await runQuoteSession(opts);

    const uberX = session.quotes.filter((q) => q.providerProductName === 'UberX');
    expect(uberX).toHaveLength(1);
    // Both candidates are retained for debugging.
    expect(session.candidates.filter((q) => q.providerProductName === 'UberX')).toHaveLength(2);
    // The material disagreement is recorded, not swallowed.
    const d = session.discrepancies.find((x) => x.provider === 'uber');
    expect(d?.severity).toBe('MATERIAL');
  });

  it('caches a repeat comparison and honours forceRefresh', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k', QUOTE_CACHE_TTL_SECONDS: '30' });
    mock.on(OBI, obiQuotes);

    const { runQuoteSession } = await import('@/orchestration/engine');
    await runQuoteSession(opts);
    expect(mock.calls).toHaveLength(1);

    const cached = await runQuoteSession(opts);
    expect(mock.calls).toHaveLength(1);
    expect(cached.outcomes[0]?.cacheHit).toBe(true);

    const fresh = await runQuoteSession({ ...opts, forceRefresh: true });
    expect(mock.calls).toHaveLength(2);
    expect(fresh.outcomes[0]?.cacheHit).toBe(false);
  });

  it('never shares an account-linked result through the public cache', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k', QUOTE_CACHE_TTL_SECONDS: '30' });
    mock.on(OBI, obiQuotes);

    const { runQuoteSession } = await import('@/orchestration/engine');
    await runQuoteSession({ ...opts, accountScope: 'user-a' });
    expect(mock.calls).toHaveLength(1);

    // A different user, and the anonymous path, must both miss.
    await runQuoteSession({ ...opts, accountScope: 'user-b' });
    expect(mock.calls).toHaveLength(2);
    await runQuoteSession(opts);
    expect(mock.calls).toHaveLength(3);
  });

  it('records a disabled source as SKIPPED with its blocker code', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k' });
    mock.on(OBI, obiQuotes);

    const { runQuoteSession } = await import('@/orchestration/engine');
    const session = await runQuoteSession(opts);
    // Only enabled sources are dispatched; the rest never appear as failures.
    expect(session.coverage.sourcesExpected).toEqual(['obi']);
  });
});

describe('fixture source safety', () => {
  it('is available outside production when explicitly enabled', async () => {
    withEnv({ NODE_ENV: 'development', RIDELENS_DEMO_SOURCE: 'enabled' });
    const { runQuoteSession } = await import('@/orchestration/engine');
    const session = await runQuoteSession(opts);
    expect(session.quotes.length).toBeGreaterThan(0);
    expect(session.quotes.every((q) => q.source === 'demo_fixture')).toBe(true);
    expect(session.outcomes[0]?.message).toMatch(/not a live market price/i);
  });

  it('is structurally impossible in production', async () => {
    withEnv({
      NODE_ENV: 'production',
      RIDELENS_DEMO_SOURCE: 'enabled',
      NEXT_PUBLIC_APP_URL: 'https://ridelens.example',
    });
    const { runQuoteSession } = await import('@/orchestration/engine');
    const session = await runQuoteSession(opts);
    expect(session.quotes).toHaveLength(0);
    expect(session.coverage.sourcesExpected).toHaveLength(0);
  });
});

describe('a cached answer says the same thing as a fresh one', () => {
  /**
   * The most useful sentence this product produces is often the one attached
   * to an empty result: "no published taxi rate card for this pickup, here is
   * what is covered". It arrives as a source warning.
   *
   * The cache-hit path used to report `message: null` regardless, so that
   * sentence was said once and then, for everyone served from cache, not at
   * all — leaving a route with no prices and no explanation. And an empty
   * result is exactly the reply most likely to be cached, because it is cheap
   * and repeatable.
   */
  it('repeats a source warning on a cache hit', async () => {
    const { runQuoteSession } = await import('@/orchestration/engine');
    const { quoteCache } = await import('@/orchestration/cache');
    quoteCache.clear();

    withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: 'true' });

    // Denver: inside no market's bounding box, so the card declines before it
    // ever needs to route, and says which cities it does cover.
    const denver = { ...PICKUP, lat: 39.7392, lng: -104.9903 };
    const nearby = { ...DESTINATION, lat: 39.75, lng: -104.98 };
    const where = { ...opts, pickup: denver, destination: nearby };

    const first = await runQuoteSession(where);
    const firstMessage = first.outcomes.find((o) => o.sourceId === 'public_rate_card')?.message;
    expect(firstMessage).toContain('No published taxi rate card');

    const second = await runQuoteSession(where);
    const cached = second.outcomes.find((o) => o.sourceId === 'public_rate_card');
    expect(cached?.cacheHit).toBe(true);
    expect(cached?.message, 'a cache hit dropped the explanation').toBe(firstMessage);
  });
});
