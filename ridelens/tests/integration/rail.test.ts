/**
 * Regional rail through the real adapter.
 *
 * The case that matters most is the one a rider reported: a house in Scarsdale
 * to an address in Chelsea returned nothing at all. It is outside every taxi
 * jurisdiction RideLens holds a card for and too far for a shared bike, and it
 * is also one of the most ordinary journeys in the country. The railroad
 * publishes a fare for it, so the app now has an answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRideLensEnv, withEnv } from '@tests/helpers';
import type { CanonicalLocation } from '@/location/types';

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

const SCARSDALE = loc(41.0176, -73.8035, '22 Murray Hill Rd, Scarsdale NY');
const CHELSEA = loc(40.7449, -74.0079, '515 W 18th St, New York NY');
const MIDTOWN = loc(40.7549, -73.984, 'Midtown Manhattan');
const SAN_FRANCISCO = loc(37.7749, -122.4194, 'San Francisco');
const OAKLAND = loc(37.8044, -122.2712, 'Oakland');

async function quote(pickup: CanonicalLocation, destination: CanonicalLocation, partySize = 1) {
  const { RegionalRailQuoteSource } = await import('@/sources/rail/RegionalRailQuoteSource');
  return new RegionalRailQuoteSource().getQuotes({
    sessionId: 'qs_test',
    pickup,
    destination,
    partySize,
    timeoutMs: 5000,
    locale: 'en-US',
  });
}

beforeEach(() => {
  clearRideLensEnv();
  withEnv({ NODE_ENV: 'development', ENABLE_REGIONAL_RAIL: 'true' });
});
afterEach(() => clearRideLensEnv());

describe('RegionalRailQuoteSource', () => {
  it('needs no credential', async () => {
    const { RegionalRailQuoteSource } = await import('@/sources/rail/RegionalRailQuoteSource');
    const gate = new RegionalRailQuoteSource().enablement();
    expect(gate.enabled).toBe(true);
    expect(gate.blockerCode).toBeNull();
  });

  it('prices the suburban trip that no taxi jurisdiction covers', async () => {
    const result = await quote(SCARSDALE, CHELSEA);
    expect(result.quotes).toHaveLength(1);
    const q = result.quotes[0];
    if (!q) throw new Error('no quote');

    expect(q.provider).toBe('transit');
    expect(q.normalizedCategory).toBe('TRANSIT');
    expect(q.source).toBe('regional_rail');
    expect(q.sourceMethod).toBe('PUBLISHED_TARIFF');
    expect(q.currency).toBe('USD');
    // Zone 4: $10.25 off-peak, $13.75 peak. Whichever applies, it is one of them.
    expect([1025, 1375]).toContain(q.priceMinMinor);
    expect([1025, 1375]).toContain(q.priceMaxMinor);
    expect(q.metadata.fareZone).toBe(4);
    expect(q.metadata.direction).toBe('INBOUND');
  });

  it('never invents a pickup ETA for a train nobody is sending', async () => {
    const q = (await quote(SCARSDALE, CHELSEA)).quotes[0];
    expect(q?.pickupEtaSeconds).toBeNull();
    // The scheduled journey, on the other hand, is published.
    expect(q?.tripDurationSeconds).toBeGreaterThan(0);
  });

  it('names both stations and how far the rider is from each', async () => {
    const q = (await quote(SCARSDALE, CHELSEA)).quotes[0];
    expect(typeof q?.metadata.boardStation).toBe('string');
    expect(q?.metadata.alightStation).toBe('Grand Central');
    expect(Number(q?.metadata.boardAccessMeters)).toBeGreaterThan(0);
    expect(String(q?.metadata.explanation)).toMatch(/not of the whole door-to-door trip/);
  });

  it('links the table it read the fare out of', async () => {
    const q = (await quote(SCARSDALE, CHELSEA)).quotes[0];
    expect(String(q?.metadata.rateCardUrl)).toMatch(/^https:\/\/www\.mta\.info\//);
    expect(q?.metadata.rateCardLabel).toBe('Published fare table');
    expect(String(q?.metadata.rateCardVerifiedOn)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('charges a party of four for four tickets', async () => {
    const one = (await quote(SCARSDALE, CHELSEA, 1)).quotes[0];
    const four = (await quote(SCARSDALE, CHELSEA, 4)).quotes[0];
    expect(four?.priceMinMinor).toBe((one?.priceMinMinor ?? 0) * 4);
    expect(four?.metadata.passengers).toBe(4);
  });

  it('sends the rider nowhere, because there is nowhere to send them', async () => {
    const q = (await quote(SCARSDALE, CHELSEA)).quotes[0];
    expect(q?.bookingHandoff?.kind).toBe('INFO_ONLY');
    expect(q?.bookingHandoff?.url).toBeNull();
    expect(String(q?.bookingHandoff?.note)).toMatch(/conductor/);
  });

  it('says why, rather than nothing, when the railroad does not serve a trip', async () => {
    const result = await quote(CHELSEA, MIDTOWN);
    expect(result.quotes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/too short for a railroad journey/i);
  });

  it('prices the Chicago suburb the city taxi card correctly refuses', async () => {
    const EVANSTON = loc(42.0451, -87.6877, 'Evanston IL');
    const LOOP = loc(41.8827, -87.6233, 'Chicago Loop');
    const q = (await quote(EVANSTON, LOOP)).quotes[0];
    expect(q?.priceMinMinor).toBe(375);
    expect(q?.priceType).toBe('UPFRONT_QUOTE');
    expect(q?.metadata.system).toBe('Metra');
    // One fare all day, so there is no onboard premium published to report.
    expect(q?.metadata.onboardFareMinor).toBeNull();
  });

  it('does not claim coverage it has not got', async () => {
    const result = await quote(SAN_FRANCISCO, OAKLAND);
    expect(result.quotes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/No regional railroad/i);
  });

  it('produces nothing at all when switched off', async () => {
    withEnv({ ENABLE_REGIONAL_RAIL: 'false' });
    const { RegionalRailQuoteSource } = await import('@/sources/rail/RegionalRailQuoteSource');
    const source = new RegionalRailQuoteSource();
    expect(source.enablement().enabled).toBe(false);
    await expect(quote(SCARSDALE, CHELSEA)).rejects.toThrow(/switched off/i);
  });

  it('reports its own health without reaching the network', async () => {
    const { RegionalRailQuoteSource } = await import('@/sources/rail/RegionalRailQuoteSource');
    const health = await new RegionalRailQuoteSource().healthCheck();
    expect(health.status).toBe('HEALTHY');
    expect(health.detail).toMatch(/stations/);
    expect(health.blockerCode).toBeNull();
  });
});
