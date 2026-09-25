/**
 * Pricing a departure that has not happened yet.
 *
 * A published tariff prices any instant, so "what will a cab to JFK cost at
 * 6:20 on Tuesday morning?" is arithmetic on a rate card rather than a
 * forecast. That makes it the one question RideLens can answer about the
 * future — and it makes the boundary between the sources that may answer it
 * and the sources that may not the thing worth guarding.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRideLensEnv, withEnv } from '@tests/helpers';
import { FetchMock } from '@tests/fetchmock';
import { CompareRequestSchema, SCHEDULE_HORIZON_DAYS } from '@/app/api/_lib/schemas';
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

const UNION_SQ = loc(40.7359, -73.9911, 'Union Square');
const JFK = loc(40.6413, -73.7781, 'JFK Airport');

function osrm(miles: number, seconds: number) {
  return { code: 'Ok', routes: [{ distance: miles * MI, duration: seconds, geometry: null }] };
}

/** A weekday at a given New York hour, safely in the future. */
function nycWeekdayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  // September is EDT, UTC-4.
  d.setUTCHours(hour + 4, minute, 0, 0);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

async function rateCard(departAt?: Date) {
  const { PublicRateCardQuoteSource } = await import(
    '@/sources/ratecard/PublicRateCardQuoteSource'
  );
  return new PublicRateCardQuoteSource().getQuotes({
    sessionId: 'qs_test',
    pickup: UNION_SQ,
    destination: JFK,
    partySize: 1,
    departAt,
    timeoutMs: 5000,
    locale: 'en-US',
  });
}

beforeEach(() => {
  clearRideLensEnv();
  withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: 'true', ENABLE_BIKE_SHARE: 'true' });
  mock.install();
});
afterEach(() => {
  mock.restore();
  clearRideLensEnv();
});

describe('a fare priced for a future departure', () => {
  it('applies the surcharge that will be in force then, not the one in force now', async () => {
    mock.on(OSRM, osrm(17.7, 1920));
    const morning = (await rateCard(nycWeekdayAt(6, 20))).quotes[0];
    mock.on(OSRM, osrm(17.7, 1920));
    const rushHour = (await rateCard(nycWeekdayAt(17, 0))).quotes[0];

    // New York adds $5.00 to the JFK flat fare between 4pm and 8pm on a
    // weekday. Both quotes are computed at the same moment; only the departure
    // they describe differs.
    expect(rushHour?.priceMinMinor).toBe((morning?.priceMinMinor ?? 0) + 500);
  });

  it('marks itself as a projection rather than a live price', async () => {
    mock.on(OSRM, osrm(17.7, 1920));
    const at = nycWeekdayAt(6, 20);
    const q = (await rateCard(at)).quotes[0];

    expect(q?.scheduledFor).toBe(at.toISOString());
    // A rule will say the same thing in an hour, so there is nothing to expire
    // and nothing a refresh could improve.
    expect(q?.expiresAt).toBeNull();
  });

  it('leaves a quote for now exactly as it was', async () => {
    mock.on(OSRM, osrm(17.7, 1920));
    const q = (await rateCard()).quotes[0];
    expect(q?.scheduledFor).toBeNull();
    expect(q?.expiresAt).not.toBeNull();
  });

  it('never lets a scheduled fare be served from a live one, or the reverse', async () => {
    const { cacheKey } = await import('@/orchestration/cache');
    const base = {
      sourceId: 'public_rate_card' as const,
      pickup: UNION_SQ,
      destination: JFK,
      accountContext: 'PUBLIC' as const,
      locale: 'en-US',
      partySize: 1,
    };
    const now = cacheKey(base);
    const later = cacheKey({ ...base, departAt: nycWeekdayAt(6, 20) });
    const different = cacheKey({ ...base, departAt: nycWeekdayAt(17, 0) });
    expect(new Set([now, later, different]).size).toBe(3);
  });
});

describe('sources that cannot honestly project', () => {
  it('bike share declines and says why, rather than quoting the fare alone', async () => {
    const { BikeShareQuoteSource } = await import('@/sources/bikeshare/BikeShareQuoteSource');
    const result = await new BikeShareQuoteSource().getQuotes({
      sessionId: 'qs_test',
      pickup: UNION_SQ,
      destination: loc(40.7549, -73.984, 'Midtown'),
      partySize: 1,
      departAt: nycWeekdayAt(6, 20),
      timeoutMs: 5000,
      locale: 'en-US',
    });
    expect(result.quotes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/live station counts/i);
    // And it did not spend an upstream call to find that out.
    expect(mock.urls()).toHaveLength(0);
  });
});

describe('the horizon a projection is allowed', () => {
  const body = {
    pickup: { kind: 'coords', lat: 40.7359, lng: -73.9911 },
    destination: { kind: 'coords', lat: 40.6413, lng: -73.7781 },
  };
  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
  const DAY = 86_400_000;

  it('accepts a departure inside the horizon', () => {
    expect(CompareRequestSchema.safeParse({ ...body, departAt: iso(DAY) }).success).toBe(true);
    expect(
      CompareRequestSchema.safeParse({ ...body, departAt: iso(SCHEDULE_HORIZON_DAYS * DAY - 1000) })
        .success,
    ).toBe(true);
  });

  it('refuses one beyond it, because the rate card behind it may not survive', () => {
    expect(
      CompareRequestSchema.safeParse({ ...body, departAt: iso(SCHEDULE_HORIZON_DAYS * DAY + DAY) })
        .success,
    ).toBe(false);
  });

  it('refuses a departure in the past, but tolerates a skewed clock', () => {
    expect(CompareRequestSchema.safeParse({ ...body, departAt: iso(-DAY) }).success).toBe(false);
    expect(CompareRequestSchema.safeParse({ ...body, departAt: iso(-60_000) }).success).toBe(true);
  });

  it('refuses a timestamp with no offset, which would mean an ambiguous instant', () => {
    expect(
      CompareRequestSchema.safeParse({ ...body, departAt: '2026-09-08T06:20:00' }).success,
    ).toBe(false);
  });
});
