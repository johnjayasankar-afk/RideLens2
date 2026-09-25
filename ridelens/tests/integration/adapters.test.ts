/**
 * Adapter integration: fixture payload -> NormalizedQuote, through the real
 * HTTP client, the real Zod schemas and the real normalisers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatRange } from '@/domain/money';
import { clearRideLensEnv, DESTINATION, PICKUP, withEnv } from '@tests/helpers';
import { FetchMock } from '@tests/fetchmock';
import uberPrices from '@tests/fixtures/uber-price-estimates.json';
import uberTimes from '@tests/fixtures/uber-time-estimates.json';
import lyftCost from '@tests/fixtures/lyft-cost.json';
import lyftEta from '@tests/fixtures/lyft-eta.json';
import empowerQuotes from '@tests/fixtures/empower-quotes.json';
import curbQuotes from '@tests/fixtures/curb-quotes.json';
import obiQuotes from '@tests/fixtures/obi-quotes.json';

const mock = new FetchMock();
const request = {
  sessionId: 'qs_test',
  pickup: PICKUP,
  destination: DESTINATION,
  partySize: 1,
  timeoutMs: 5_000,
  locale: 'en-US',
};

beforeEach(() => {
  clearRideLensEnv();
  mock.install();
});
afterEach(() => {
  mock.restore();
  clearRideLensEnv();
});

describe('Obi adapter', () => {
  it('normalises a multi-provider payload with mixed price semantics', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'test-key' });
    mock.on('/v1/quotes', obiQuotes);

    const { ObiQuoteSource } = await import('@/sources/obi/ObiQuoteSource');
    const result = await new ObiQuoteSource().getQuotes(request);

    // Identical canonical coordinates are sent, which is what makes the
    // comparison valid at all.
    const body = mock.calls[0]?.body as { pickup: { lat: number }; dropoff: { lat: number } };
    expect(body.pickup.lat).toBe(PICKUP.lat);
    expect(body.dropoff.lat).toBe(DESTINATION.lat);

    const byId = new Map(result.quotes.map((q) => [q.providerProductId, q]));

    const uberx = byId.get('a1111c8c-c720-46c3-8534-2fcdd730040d');
    expect(uberx?.provider).toBe('uber');
    expect(uberx?.priceType).toBe('ESTIMATE_RANGE');
    expect(uberx?.priceMinMinor).toBe(2700);
    expect(uberx?.priceMaxMinor).toBe(3400);
    expect(uberx?.rankingPriceMinor).toBe(3050);
    expect(uberx?.normalizedCategory).toBe('STANDARD');
    // The range is rendered as a range; the midpoint is never printed.
    expect(formatRange(uberx!.priceMinMinor, uberx!.priceMaxMinor, 'USD')).toBe('$27–34');

    const empower = byId.get('everyday');
    expect(empower?.provider).toBe('empower');
    expect(empower?.priceType).toBe('ESTIMATE');
    expect(empower?.priceMinMinor).toBe(2384);
    expect(empower?.confidenceClass).toBe('MEDIUM');

    // Only an explicit upfront flag produces UPFRONT_QUOTE.
    const curb = byId.get('taxi-upfront');
    expect(curb?.priceType).toBe('UPFRONT_QUOTE');
    expect(curb?.priceMinMinor).toBe(2840);
    expect(curb?.normalizedCategory).toBe('TAXI');
    expect(curb?.confidenceClass).toBe('HIGH');
    expect(curb?.expiresAt).toBe('2026-09-03T18:27:40.000Z');

    const green = byId.get('5f41547d-805d-4207-a297-51c571cf2a8c');
    expect(green?.availability).toBe('UNAVAILABLE');
    expect(green?.normalizedCategory).toBe('EV');

    expect(byId.get('waymo-one')?.normalizedCategory).toBe('AUTONOMOUS');

    // An unmapped brand surfaces as OTHER with a warning, never as a guess.
    expect(byId.get('x1')?.provider).toBe('other');
    expect(result.warnings.join(' ')).toMatch(/Unmapped provider/i);

    for (const q of result.quotes) {
      expect(q.source).toBe('obi');
      expect(q.sourceMethod).toBe('AGGREGATOR_API');
      expect(q.accountContext).toBe('PUBLIC');
    }

    // The Curb entry carries a provider expiry that has already passed. A
    // provider expiry is authoritative, so that quote is EXPIRED on arrival
    // even though we just received it, while the rest are LIVE.
    expect(curb?.freshness).toBe('EXPIRED');
    expect(uberx?.freshness).toBe('LIVE');
    expect(empower?.freshness).toBe('LIVE');
  });

  it('honours a future provider expiry as LIVE', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k' });
    const future = new Date(Date.now() + 120_000).toISOString();
    mock.on('/v1/quotes', {
      results: [
        {
          provider: 'curb',
          product_id: 'taxi',
          product_name: 'Curb Taxi',
          price: { amount: '28.40', currency: 'USD', is_upfront: true },
          expires_at: future,
          available: true,
        },
      ],
    });
    const { ObiQuoteSource } = await import('@/sources/obi/ObiQuoteSource');
    const result = await new ObiQuoteSource().getQuotes(request);
    expect(result.quotes[0]?.freshness).toBe('LIVE');
    expect(result.quotes[0]?.expiresAt).toBe(future);
  });

  it('rejects a malformed payload rather than inventing data', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k' });
    mock.on('/v1/quotes', { results: [{ nonsense: true }] });
    const { ObiQuoteSource } = await import('@/sources/obi/ObiQuoteSource');
    await expect(new ObiQuoteSource().getQuotes(request)).rejects.toMatchObject({ kind: 'SCHEMA' });
  });

  it('drops a product with no currency instead of assuming USD', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k' });
    mock.on('/v1/quotes', {
      results: [
        { provider: 'uber', product_id: 'p', product_name: 'UberX', price: { amount: 25 } },
      ],
    });
    const { ObiQuoteSource } = await import('@/sources/obi/ObiQuoteSource');
    const result = await new ObiQuoteSource().getQuotes(request);
    expect(result.quotes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/no currency/i);
  });

  it('maps a 401 to UNAUTHORIZED', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'bad' });
    mock.on('/v1/quotes', { error: 'nope' }, 401);
    const { ObiQuoteSource } = await import('@/sources/obi/ObiQuoteSource');
    await expect(new ObiQuoteSource().getQuotes(request)).rejects.toMatchObject({
      kind: 'UNAUTHORIZED',
    });
  });

  it('refuses to run at all without a key', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { ObiQuoteSource } = await import('@/sources/obi/ObiQuoteSource');
    await expect(new ObiQuoteSource().getQuotes(request)).rejects.toMatchObject({
      kind: 'DISABLED',
    });
    expect(mock.calls).toHaveLength(0);
  });
});

describe('Uber adapter', () => {
  it('normalises ranges, ETAs and miles once comparison rights are asserted', async () => {
    withEnv({
      NODE_ENV: 'development',
      UBER_SERVER_TOKEN: 'srv',
      UBER_COMPARISON_RIGHTS_GRANTED: 'true',
    });
    mock.on('/v1.2/estimates/price', uberPrices).on('/v1.2/estimates/time', uberTimes);

    const { UberAuthorizedQuoteSource } = await import('@/sources/uber/UberAuthorizedQuoteSource');
    const result = await new UberAuthorizedQuoteSource().getQuotes(request);

    const uberx = result.quotes.find((q) => q.providerProductName === 'UberX');
    expect(uberx?.priceType).toBe('ESTIMATE_RANGE');
    expect(uberx?.priceMinMinor).toBe(2700);
    expect(uberx?.priceMaxMinor).toBe(3400);
    expect(uberx?.pickupEtaSeconds).toBe(120);
    // 16.51 miles -> metres, not left as miles.
    expect(uberx?.distanceMeters).toBe(26570);
    // The range is an estimate, never re-labelled as an upfront fare.
    expect(uberx?.priceType).not.toBe('UPFRONT_QUOTE');

    expect(result.quotes.find((q) => q.providerProductName === 'UberXL')?.normalizedCategory).toBe(
      'XL',
    );
    expect(
      result.quotes.find((q) => q.providerProductName === 'Uber Black')?.normalizedCategory,
    ).toBe('LUXURY');

    // "Metered" is not a number; the product is dropped, not parsed as zero.
    expect(result.quotes.some((q) => q.providerProductName === 'Taxi')).toBe(false);

    // Price and ETA are fetched concurrently, not one after the other.
    expect(mock.urls().some((u) => u.includes('estimates/price'))).toBe(true);
    expect(mock.urls().some((u) => u.includes('estimates/time'))).toBe(true);
  });

  it('still returns prices when the ETA call fails', async () => {
    withEnv({
      NODE_ENV: 'development',
      UBER_SERVER_TOKEN: 'srv',
      UBER_COMPARISON_RIGHTS_GRANTED: 'true',
    });
    mock.on('/v1.2/estimates/price', uberPrices).onError('/v1.2/estimates/time');

    const { UberAuthorizedQuoteSource } = await import('@/sources/uber/UberAuthorizedQuoteSource');
    const result = await new UberAuthorizedQuoteSource().getQuotes(request);
    expect(result.quotes.length).toBeGreaterThan(0);
    expect(result.quotes[0]?.pickupEtaSeconds).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/ETA call failed/i);
  });

  it('makes no network call at all while the policy gate is closed', async () => {
    withEnv({ NODE_ENV: 'development', UBER_SERVER_TOKEN: 'srv' });
    const { UberAuthorizedQuoteSource } = await import('@/sources/uber/UberAuthorizedQuoteSource');
    await expect(new UberAuthorizedQuoteSource().getQuotes(request)).rejects.toMatchObject({
      kind: 'DISABLED',
    });
    expect(mock.calls).toHaveLength(0);
  });
});

describe('Lyft adapter', () => {
  it('treats cost cents as minor units without rescaling them', async () => {
    withEnv({ NODE_ENV: 'development', LYFT_CLIENT_ID: 'id', LYFT_CLIENT_SECRET: 'secret' });
    mock
      .on('/oauth/token', { access_token: 'tok', expires_in: 3600 })
      .on('/v1/cost', lyftCost)
      .on('/v1/eta', lyftEta);

    const { LyftAuthorizedQuoteSource } = await import('@/sources/lyft/LyftAuthorizedQuoteSource');
    const result = await new LyftAuthorizedQuoteSource().getQuotes(request);

    const standard = result.quotes.find((q) => q.providerProductId === 'lyft');
    // 2784 cents stays 2784 minor units.
    expect(standard?.priceMinMinor).toBe(2784);
    expect(standard?.priceMaxMinor).toBe(3199);
    expect(standard?.priceType).toBe('ESTIMATE_RANGE');
    expect(standard?.pickupEtaSeconds).toBe(300);
    expect(standard?.normalizedCategory).toBe('STANDARD');

    expect(result.quotes.find((q) => q.providerProductId === 'lyft_xl')?.normalizedCategory).toBe(
      'XL',
    );
    expect(
      result.quotes.find((q) => q.providerProductId === 'lyft_luxsuv')?.normalizedCategory,
    ).toBe('LUXURY');

    // is_valid_estimate === false is excluded rather than shown as a price.
    expect(result.quotes.some((q) => q.providerProductId === 'lyft_plus')).toBe(false);
  });

  it('is blocked by default because the public programme is closed', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { LyftAuthorizedQuoteSource } = await import('@/sources/lyft/LyftAuthorizedQuoteSource');
    const gate = new LyftAuthorizedQuoteSource().enablement();
    expect(gate.enabled).toBe(false);
    expect(gate.blockerCode).toBe('NO_PUBLIC_ENDPOINT');
  });
});

describe('Empower adapter', () => {
  it('labels a driver-priced fare as an ESTIMATE, never as upfront', async () => {
    withEnv({
      NODE_ENV: 'development',
      EMPOWER_API_KEY: 'k',
      EMPOWER_API_BASE_URL: 'https://partner.example.com',
    });
    mock.on('/v1/quotes', empowerQuotes);

    const { EmpowerAuthorizedQuoteSource } = await import(
      '@/sources/empower/EmpowerAuthorizedQuoteSource'
    );
    const result = await new EmpowerAuthorizedQuoteSource().getQuotes(request);

    const everyday = result.quotes.find((q) => q.providerProductId === 'everyday');
    expect(everyday?.priceType).toBe('ESTIMATE');
    expect(everyday?.priceMinMinor).toBe(2384);
    expect(everyday?.confidenceClass).toBe('MEDIUM');
    expect(result.quotes.every((q) => q.priceType !== 'UPFRONT_QUOTE')).toBe(true);

    expect(
      result.quotes.find((q) => q.providerProductId === 'everyday-xl')?.normalizedCategory,
    ).toBe('XL');
    expect(result.quotes.find((q) => q.providerProductId === 'premium')?.availability).toBe(
      'UNAVAILABLE',
    );
  });

  it('emits UPFRONT_QUOTE only when the payload explicitly guarantees the fare', async () => {
    withEnv({
      NODE_ENV: 'development',
      EMPOWER_API_KEY: 'k',
      EMPOWER_API_BASE_URL: 'https://partner.example.com',
    });
    mock.on('/v1/quotes', {
      quotes: [
        {
          tier_id: 'everyday',
          tier_name: 'Everyday',
          currency: 'USD',
          estimated_fare: 23.84,
          fare_is_guaranteed: true,
        },
      ],
    });
    const { EmpowerAuthorizedQuoteSource } = await import(
      '@/sources/empower/EmpowerAuthorizedQuoteSource'
    );
    const result = await new EmpowerAuthorizedQuoteSource().getQuotes(request);
    expect(result.quotes[0]?.priceType).toBe('UPFRONT_QUOTE');
    expect(result.quotes[0]?.confidenceClass).toBe('HIGH');
  });
});

describe('Curb adapter', () => {
  it('separates an upfront market from a metered one', async () => {
    withEnv({ NODE_ENV: 'development', CURB_API_KEY: 'k' });
    mock.on('/flow/v1/quotes', curbQuotes);

    const { CurbFlowQuoteSource } = await import('@/sources/curb/CurbFlowQuoteSource');
    const result = await new CurbFlowQuoteSource().getQuotes(request);

    const upfront = result.quotes.find((q) => q.providerProductId === 'taxi-upfront');
    expect(upfront?.priceType).toBe('UPFRONT_QUOTE');
    expect(upfront?.priceMinMinor).toBe(2840);
    expect(upfront?.normalizedCategory).toBe('TAXI');
    expect(upfront?.expiresAt).toBe('2026-09-03T18:27:41.000Z');

    const metered = result.quotes.find((q) => q.providerProductId === 'taxi-metered');
    // A metered band is a range, and it is NOT called upfront.
    expect(metered?.priceType).toBe('ESTIMATE_RANGE');
    expect(metered?.priceMinMinor).toBe(2600);
    expect(metered?.priceMaxMinor).toBe(3350);

    expect(result.quotes.find((q) => q.providerProductId === 'taxi-wav')?.normalizedCategory).toBe(
      'ACCESSIBLE',
    );
    // Curb supply never lands in STANDARD.
    expect(result.quotes.every((q) => q.normalizedCategory !== 'STANDARD')).toBe(true);
  });
});
