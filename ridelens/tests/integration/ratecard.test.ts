/**
 * The rate card through the real adapter and the real engine, with only the
 * routing socket replaced.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRideLensEnv, withEnv } from '@tests/helpers';
import { FetchMock } from '@tests/fetchmock';
import type { CanonicalLocation } from '@/location/types';

const mock = new FetchMock();
const OSRM = 'router.project-osrm.org';
const MI = 1609.344;

const loc = (lat: number, lng: number, name: string): CanonicalLocation => ({
  lat,
  lng,
  formattedAddress: name,
  placeId: null,
  name,
  city: null,
  region: null,
  country: 'US',
  geocoder: 'fixture',
});

const PRINCE = loc(40.7233, -73.9959, '14 Prince St');
const JFK = loc(40.6413, -73.7781, 'JFK Airport');
const UPPER_WEST = loc(40.7871, -73.9754, 'Upper West Side');
const LONDON = loc(51.5072, -0.1276, 'Trafalgar Square');

function osrmReply(miles: number, seconds: number) {
  return { code: 'Ok', routes: [{ distance: miles * MI, duration: seconds, geometry: null }] };
}

async function quote(pickup: CanonicalLocation, destination: CanonicalLocation) {
  const { PublicRateCardQuoteSource } = await import(
    '@/sources/ratecard/PublicRateCardQuoteSource'
  );
  return new PublicRateCardQuoteSource().getQuotes({
    sessionId: 'qs_test',
    pickup,
    destination,
    partySize: 1,
    timeoutMs: 5000,
    locale: 'en-US',
  });
}

beforeEach(() => {
  clearRideLensEnv();
  withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: 'true' });
  mock.install();
});
afterEach(() => {
  mock.restore();
  clearRideLensEnv();
});

describe('PublicRateCardQuoteSource', () => {
  it('needs no credential — that is the whole point', async () => {
    const { PublicRateCardQuoteSource } = await import(
      '@/sources/ratecard/PublicRateCardQuoteSource'
    );
    const gate = new PublicRateCardQuoteSource().enablement();
    expect(gate.enabled).toBe(true);
    expect(gate.blockerCode).toBeNull();
  });

  it('emits an UPFRONT_QUOTE for an airport flat fare', async () => {
    mock.on(OSRM, osrmReply(17.7, 1920));
    const result = await quote(PRINCE, JFK);

    const q = result.quotes[0];
    expect(q).toBeDefined();
    expect(q?.priceType).toBe('UPFRONT_QUOTE');
    expect(q?.confidenceClass).toBe('HIGH');
    // A rule has no band.
    expect(q?.priceMinMinor).toBe(q?.priceMaxMinor);
    expect(q?.provider).toBe('taxi');
    expect(q?.normalizedCategory).toBe('TAXI');
    expect(q?.sourceMethod).toBe('PUBLISHED_TARIFF');
  });

  it('emits a METERED_ESTIMATE band for a city trip', async () => {
    mock.on(OSRM, osrmReply(4, 1500));
    const result = await quote(PRINCE, UPPER_WEST);

    const q = result.quotes[0];
    expect(q?.priceType).toBe('METERED_ESTIMATE');
    expect(q?.priceMaxMinor).toBeGreaterThan(q?.priceMinMinor ?? 0);
    // A meter outcome depends on traffic we cannot see.
    expect(q?.confidenceClass).toBe('LOW');
    expect(result.warnings.join(' ')).toMatch(/slow traffic/i);
  });

  it('never claims to know the pickup ETA or the trip duration', async () => {
    mock.on(OSRM, osrmReply(4, 1500));
    const q = (await quote(PRINCE, UPPER_WEST)).quotes[0];
    // A rate card knows the fare, not where the cabs are.
    expect(q?.pickupEtaSeconds).toBeNull();
    // The routed duration is a map estimate, never a provider's own figure.
    expect(q?.tripDurationSeconds).toBeNull();
    expect(q?.availability).toBe('UNKNOWN');
  });

  it('carries the rate card provenance on the quote', async () => {
    mock.on(OSRM, osrmReply(17.7, 1920));
    const q = (await quote(PRINCE, JFK)).quotes[0];
    expect(q?.metadata.authority).toMatch(/Taxi & Limousine Commission/);
    expect(String(q?.metadata.rateCardUrl)).toMatch(/^https:\/\//);
    expect(String(q?.metadata.rateCardVerifiedOn)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(q?.metadata.breakdown)).toContain('flat fare');
  });

  it('returns nothing, and says which markets it covers, outside a covered city', async () => {
    const result = await quote(LONDON, LONDON);
    expect(result.quotes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/No published taxi rate card/);
    expect(result.warnings.join(' ')).toMatch(/New York City/);
    // It must not have wasted an upstream call on a route it cannot price.
    expect(mock.calls).toHaveLength(0);
  });

  it('fails honestly when the route cannot be measured', async () => {
    mock.onError(OSRM);
    await expect(quote(PRINCE, UPPER_WEST)).rejects.toMatchObject({ kind: 'UPSTREAM' });
  });

  it('is off when an operator disables it', async () => {
    withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: 'false' });
    await expect(quote(PRINCE, JFK)).rejects.toMatchObject({ kind: 'DISABLED' });
  });
});

describe('rate card in a full session', () => {
  it('produces a live quote with no credentials configured at all', async () => {
    withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: 'true' });
    mock.on(OSRM, osrmReply(17.7, 1920));

    const { runQuoteSession } = await import('@/orchestration/engine');
    const session = await runQuoteSession({
      pickup: PRINCE,
      destination: JFK,
      partySize: 1,
      timeoutMs: 5000,
    });

    expect(session.status).toBe('SUCCESS');
    expect(session.coverage.sourcesSucceeded).toEqual(['public_rate_card']);
    expect(session.coverage.providersReturned).toEqual(['taxi']);
    expect(session.quotes).toHaveLength(1);
  });

  it('ranks a regulated fare as bookable despite unknown availability', async () => {
    withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: 'true' });
    mock.on(OSRM, osrmReply(17.7, 1920));

    const { runQuoteSession } = await import('@/orchestration/engine');
    const { isBookable } = await import('@/domain/ranking');
    const session = await runQuoteSession({ pickup: PRINCE, destination: JFK, timeoutMs: 5000 });

    const q = session.quotes[0];
    expect(q).toBeDefined();
    // UNKNOWN availability means "not stated", not "no".
    expect(q && isBookable(q)).toBe(true);
  });

  it('reports live data as available on the health endpoint', async () => {
    withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: 'true' });
    const { GET } = await import('@/app/api/health/route');
    const body = await (await GET()).json();
    expect(body.liveDataAvailable).toBe(true);
    expect(body.liveSources).toContain('public_rate_card');
    // The "no live source" startup error must be gone.
    expect(body.checks.map((c: { code: string }) => c.code)).not.toContain('NO_LIVE_QUOTE_SOURCE');
  });
});

describe('an uncovered market is explained, not guessed', () => {
  it('surfaces the reason through a successful outcome with zero quotes', async () => {
    withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: 'true' });
    const { runQuoteSession } = await import('@/orchestration/engine');
    const DENVER = loc(39.7392, -104.9903, 'Denver');
    const session = await runQuoteSession({
      pickup: DENVER,
      destination: loc(39.7371, -104.9895, 'Denver Art Museum'),
      partySize: 1,
      timeoutMs: 5000,
    });

    expect(session.quotes).toHaveLength(0);
    const outcome = session.outcomes.find((o) => o.sourceId === 'public_rate_card');
    // The source succeeded — it simply has nothing to say about Denver — and
    // the reason must survive on the outcome so the UI can show it.
    expect(outcome?.status).toBe('OK');
    expect(outcome?.quoteCount).toBe(0);
    expect(outcome?.message).toMatch(/No published taxi rate card/);
    expect(outcome?.message).toMatch(/New York City/);
  });
});
