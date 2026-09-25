/**
 * The whole chain, as requirement 86 draws it:
 *   typed addresses -> location normalizer -> quote session -> source registry
 *   -> parallel fetch -> schema validation -> normalization -> reconciliation
 *   -> quote semantics -> freshness -> ranking -> API response.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedQuote } from '@/domain/quote';
import { compareWithUncertainty, intervalOf } from '@/domain/uncertainty';
import { clearRideLensEnv, withEnv } from '@tests/helpers';
import { FetchMock } from '@tests/fetchmock';
import obiQuotes from '@tests/fixtures/obi-quotes.json';
import curbQuotes from '@tests/fixtures/curb-quotes.json';

const mock = new FetchMock();
const OBI = 'api.rideobi.com/v1/quotes';
const CURB = 'api.gocurb.com/flow/v1/quotes';

beforeEach(() => {
  clearRideLensEnv();
  mock.install();
});
afterEach(() => {
  mock.restore();
  clearRideLensEnv();
});

async function postCompare(body: unknown) {
  const { POST } = await import('@/app/api/quotes/route');
  return POST(
    new Request('https://ridelens.test/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.7' },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/quotes', () => {
  it('runs the full chain from typed addresses to a ranked response', async () => {
    withEnv({
      NODE_ENV: 'development',
      GEOCODER_PROVIDER: 'fixture',
      OBI_API_KEY: 'k',
      CURB_API_KEY: 'k',
      RATE_LIMIT_MAX_REQUESTS: '100',
    });
    mock.on(OBI, obiQuotes).on(CURB, curbQuotes);

    const res = await postCompare({
      pickup: { kind: 'query', text: '14 Prince St' },
      destination: { kind: 'query', text: 'JFK' },
    });
    expect(res.status).toBe(200);
    const session = await res.json();

    // Location normalizer produced ONE canonical pair.
    expect(session.pickup.name).toBe('14 Prince St');
    expect(session.destination.name).toBe('JFK Terminal 4');

    // Every source received the identical coordinates.
    const obiBody = mock.calls.find((c) => c.url.includes(OBI))?.body as {
      pickup: { lat: number; lng: number };
    };
    const curbBody = mock.calls.find((c) => c.url.includes(CURB))?.body as {
      pickup: { latitude: number; longitude: number };
    };
    expect(obiBody.pickup.lat).toBe(session.pickup.lat);
    expect(curbBody.pickup.latitude).toBe(session.pickup.lat);
    expect(obiBody.pickup.lng).toBe(curbBody.pickup.longitude);

    expect(session.status).toBe('SUCCESS');
    expect(session.coverage.sourcesSucceeded).toEqual(expect.arrayContaining(['obi', 'curb_flow']));
    expect(session.coverage.providersReturned).toEqual(
      expect.arrayContaining(['uber', 'lyft', 'empower', 'curb']),
    );

    /**
     * Ranked cheapest-first, but by the uncertainty-aware comparator rather
     * than a raw numeric sort: two overlapping ranges may legitimately appear
     * in either order. The invariant that must hold is that no later option is
     * *definitely* cheaper than an earlier one.
     */
    const bookable: NormalizedQuote[] = session.quotes.filter(
      (q: NormalizedQuote) => q.availability === 'AVAILABLE' && q.freshness !== 'EXPIRED',
    );
    expect(bookable.length).toBeGreaterThan(2);
    for (let i = 1; i < bookable.length; i += 1) {
      const prev = bookable[i - 1] as NormalizedQuote;
      const next = bookable[i] as NormalizedQuote;
      if (prev.currency !== next.currency) continue;
      expect(compareWithUncertainty(intervalOf(next), intervalOf(prev))).not.toBe('A_CHEAPER');
    }
    // And the top result is not beaten outright by anything below it.
    const top = bookable[0] as NormalizedQuote;
    for (const q of bookable.slice(1)) {
      expect(compareWithUncertainty(intervalOf(q), intervalOf(top))).not.toBe('A_CHEAPER');
    }

    // Semantics survived the whole pipeline.
    const empower = session.quotes.find((q: { provider: string }) => q.provider === 'empower');
    expect(empower.priceType).toBe('ESTIMATE');
    const uberx = session.quotes.find(
      (q: { providerProductName: string }) => q.providerProductName === 'UberX',
    );
    expect(uberx.priceType).toBe('ESTIMATE_RANGE');
    expect(uberx.priceMinMinor).toBe(2700);
    expect(uberx.priceMaxMinor).toBe(3400);

    // Every quote carries all three truth axes.
    for (const q of session.quotes as NormalizedQuote[]) {
      expect(q.priceType).toBeTruthy();
      expect(q.freshness).toBeTruthy();
      expect(q.accountContext).toBeTruthy();
    }

    // Known providers get a booking handoff; an unrecognised brand gets none,
    // because inventing a booking URL for a provider we cannot identify would
    // be worse than offering no button at all.
    for (const q of session.quotes as NormalizedQuote[]) {
      if (q.provider === 'other') {
        expect(q.bookingHandoff).toBeNull();
      } else {
        expect(q.bookingHandoff).not.toBeNull();
        expect(q.bookingHandoff?.url?.startsWith('https://')).toBe(true);
      }
    }
  });

  it('refuses with 503 rather than showing anything when no source is configured', async () => {
    withEnv({
      NODE_ENV: 'development',
      GEOCODER_PROVIDER: 'fixture',
      RATE_LIMIT_MAX_REQUESTS: '100',
    });
    const res = await postCompare({
      pickup: { kind: 'query', text: '14 Prince St' },
      destination: { kind: 'query', text: 'JFK' },
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('NO_SOURCE_CONFIGURED');
  });

  it('rejects an unresolvable location with a specific code', async () => {
    withEnv({
      NODE_ENV: 'development',
      GEOCODER_PROVIDER: 'fixture',
      OBI_API_KEY: 'k',
      RATE_LIMIT_MAX_REQUESTS: '100',
    });
    const res = await postCompare({
      pickup: { kind: 'query', text: 'zzzz nowhere zzzz' },
      destination: { kind: 'query', text: 'JFK' },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('PICKUP_UNRESOLVED');
  });

  it('rejects a route whose endpoints are the same place', async () => {
    withEnv({
      NODE_ENV: 'development',
      GEOCODER_PROVIDER: 'fixture',
      OBI_API_KEY: 'k',
      RATE_LIMIT_MAX_REQUESTS: '100',
    });
    const res = await postCompare({
      pickup: { kind: 'query', text: 'JFK' },
      destination: { kind: 'query', text: 'JFK' },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('SAME_POINT');
  });

  it('validates the request body', async () => {
    withEnv({
      NODE_ENV: 'development',
      GEOCODER_PROVIDER: 'fixture',
      OBI_API_KEY: 'k',
      RATE_LIMIT_MAX_REQUESTS: '100',
    });
    const res = await postCompare({
      pickup: { kind: 'coords', lat: 999, lng: 0 },
      destination: { kind: 'query', text: 'JFK' },
    });
    expect(res.status).toBe(400);
  });

  it('enforces the rate limit server-side', async () => {
    withEnv({
      NODE_ENV: 'development',
      GEOCODER_PROVIDER: 'fixture',
      OBI_API_KEY: 'k',
      RATE_LIMIT_MAX_REQUESTS: '2',
      RATE_LIMIT_WINDOW_SECONDS: '60',
      QUOTE_CACHE_TTL_SECONDS: '0',
    });
    mock.on(OBI, obiQuotes);
    const body = {
      pickup: { kind: 'query', text: '14 Prince St' },
      destination: { kind: 'query', text: 'JFK' },
    };
    expect((await postCompare(body)).status).toBe(200);
    expect((await postCompare(body)).status).toBe(200);
    const limited = await postCompare(body);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
    expect(limited.headers.get('X-RateLimit-Remaining')).toBe('0');
  });
});

describe('POST /api/quotes/stream', () => {
  it('streams a session header, per-source events and a final complete event', async () => {
    withEnv({
      NODE_ENV: 'development',
      GEOCODER_PROVIDER: 'fixture',
      OBI_API_KEY: 'k',
      CURB_API_KEY: 'k',
      RATE_LIMIT_MAX_REQUESTS: '100',
    });
    mock.on(OBI, obiQuotes).on(CURB, curbQuotes);

    const { POST } = await import('@/app/api/quotes/stream/route');
    const res = await POST(
      new Request('https://ridelens.test/api/quotes/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.8' },
        body: JSON.stringify({
          pickup: { kind: 'query', text: '14 Prince St' },
          destination: { kind: 'query', text: 'JFK' },
        }),
      }),
    );

    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
    const text = await res.text();
    const events = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string });

    expect(events[0]?.type).toBe('session');
    expect(events.filter((e) => e.type === 'source')).toHaveLength(2);
    expect(events[events.length - 1]?.type).toBe('complete');

    const header = events[0] as unknown as { providersExpected: string[]; fixtureBacked: boolean };
    expect(header.providersExpected).toEqual(expect.arrayContaining(['uber', 'lyft', 'curb']));
    expect(header.fixtureBacked).toBe(false);
  });

  it('reports the failing source in-band and still completes', async () => {
    withEnv({
      NODE_ENV: 'development',
      GEOCODER_PROVIDER: 'fixture',
      OBI_API_KEY: 'k',
      CURB_API_KEY: 'k',
      RATE_LIMIT_MAX_REQUESTS: '100',
      QUOTE_REQUEST_TIMEOUT_MS: '1000',
    });
    mock.onError(OBI).on(CURB, curbQuotes);

    const { POST } = await import('@/app/api/quotes/stream/route');
    const res = await POST(
      new Request('https://ridelens.test/api/quotes/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.9' },
        body: JSON.stringify({
          pickup: { kind: 'query', text: '14 Prince St' },
          destination: { kind: 'query', text: 'JFK' },
        }),
      }),
    );
    const events = (await res.text())
      .trim()
      .split('\n')
      .map(
        (l) =>
          JSON.parse(l) as {
            type: string;
            outcome?: { sourceId: string; status: string };
            session?: { status: string };
          },
      );

    const obiEvent = events.find((e) => e.outcome?.sourceId === 'obi');
    expect(obiEvent?.outcome?.status).toBe('ERROR');
    const complete = events.find((e) => e.type === 'complete');
    expect(complete?.session?.status).toBe('PARTIAL');
  });
});

describe('POST /api/handoff', () => {
  async function post(body: unknown, ip = '198.51.100.20') {
    const { POST } = await import('@/app/api/handoff/route');
    return POST(
      new Request('https://ridelens.test/api/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify(body),
      }),
    );
  }

  const valid = {
    provider: 'uber',
    url: 'https://m.uber.com/looking?client_id=abc',
    quoteKey: 'obi:uber:uberx',
    handoffKind: 'PREFILLED_DEEPLINK',
  };

  beforeEach(() => withEnv({ NODE_ENV: 'development', RATE_LIMIT_MAX_REQUESTS: '100' }));

  it('returns an allowlisted destination', async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect((await res.json()).host).toBe('m.uber.com');
  });

  it('refuses an off-allowlist destination even if the client asks nicely', async () => {
    const res = await post({ ...valid, url: 'https://attacker.example/phish' }, '198.51.100.21');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('DESTINATION_NOT_ALLOWED');
  });

  it('refuses a lookalike domain', async () => {
    const res = await post({ ...valid, url: 'https://m.uber.com.evil.tld/x' }, '198.51.100.22');
    expect(res.status).toBe(400);
  });

  it("refuses one provider's link under another provider's name", async () => {
    const res = await post({ ...valid, provider: 'curb' }, '198.51.100.23');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/health', () => {
  it('states plainly that no live data is available', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { GET } = await import('@/app/api/health/route');
    const body = await (await GET()).json();
    expect(body.liveDataAvailable).toBe(false);
    expect(body.liveSources).toEqual([]);
    expect(body.checks.map((c: { code: string }) => c.code)).toContain('NO_LIVE_QUOTE_SOURCE');
    const uber = body.sources.find((s: { sourceId: string }) => s.sourceId === 'uber_direct');
    expect(uber.blockerCode).toBe('POLICY_PROHIBITED');
  });

  it('reports live availability once a source is configured', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k' });
    const { GET } = await import('@/app/api/health/route');
    const body = await (await GET()).json();
    expect(body.liveDataAvailable).toBe(true);
    expect(body.liveSources).toContain('obi');
  });

  it('never counts the fixture source as live data', async () => {
    withEnv({ NODE_ENV: 'development', RIDELENS_DEMO_SOURCE: 'enabled' });
    const { GET } = await import('@/app/api/health/route');
    const body = await (await GET()).json();
    expect(body.liveDataAvailable).toBe(false);
    expect(body.fixtureSourceActive).toBe(true);
  });
});
