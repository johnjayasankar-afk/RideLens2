/**
 * The GBFS adapter through the real client and schemas, with only the socket
 * replaced.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRideLensEnv, withEnv } from '@tests/helpers';
import { FetchMock } from '@tests/fetchmock';
import type { CanonicalLocation } from '@/location/types';

const mock = new FetchMock();
const OSRM = 'router.project-osrm.org';

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
const WASHINGTON_SQ = loc(40.7308, -73.9973, 'Washington Square');
const LONDON = loc(51.5072, -0.1276, 'Trafalgar Square');

function feeds() {
  return {
    data: {
      en: {
        feeds: [
          {
            name: 'station_information',
            url: 'https://gbfs.citibikenyc.com/gbfs/en/station_information.json',
          },
          {
            name: 'station_status',
            url: 'https://gbfs.citibikenyc.com/gbfs/en/station_status.json',
          },
          {
            name: 'system_pricing_plans',
            url: 'https://gbfs.citibikenyc.com/gbfs/en/system_pricing_plans.json',
          },
        ],
      },
    },
  };
}

const stationInfo = {
  data: {
    stations: [
      {
        station_id: 'a',
        name: 'University Pl & E 14 St',
        lat: 40.7361,
        lon: -73.9913,
        capacity: 40,
      },
      {
        station_id: 'b',
        name: 'Sullivan St & Washington Sq',
        lat: 40.7309,
        lon: -73.9975,
        capacity: 40,
      },
    ],
  },
};

function stationStatus(over: Record<string, unknown> = {}) {
  return {
    last_updated: 1788499359,
    ttl: 60,
    data: {
      stations: [
        {
          station_id: 'a',
          num_bikes_available: 12,
          num_ebikes_available: 2,
          num_docks_available: 8,
          is_renting: 1,
          is_returning: 1,
          ...over,
        },
        {
          station_id: 'b',
          num_bikes_available: 4,
          num_ebikes_available: 0,
          num_docks_available: 37,
          is_renting: 1,
          is_returning: 1,
        },
      ],
    },
  };
}

const pricing = {
  data: {
    plans: [
      {
        plan_id: 'SINGLE_RIDE',
        name: 'SINGLE RIDE',
        currency: 'USD',
        price: '4.99',
        description: '$4.99 unlock fee, $0.41 per minute.',
      },
      {
        plan_id: 'EBIKE_SINGLE_RIDE',
        name: 'EBIKE SINGLE RIDE',
        currency: 'USD',
        price: '5.99',
        description: '$5.99 unlock fee, $0.55 per minute.',
      },
    ],
  },
};

function installFeeds(over?: { plans?: unknown[]; status?: unknown }) {
  mock
    .on('gbfs.citibikenyc.com/gbfs/gbfs.json', feeds())
    .on('station_information.json', stationInfo)
    .on('station_status.json', over?.status ?? stationStatus())
    .on('system_pricing_plans.json', over?.plans ? { data: { plans: over.plans } } : pricing)
    .on(OSRM, { code: 'Ok', routes: [{ distance: 1200, duration: 300 }] });
}

/** The station-status feed with the pickup station's counts overridden. */
function statusWith(over: Record<string, number>) {
  return stationStatus(over);
}

async function quote(pickup: CanonicalLocation, destination: CanonicalLocation) {
  const { BikeShareQuoteSource } = await import('@/sources/bikeshare/BikeShareQuoteSource');
  return new BikeShareQuoteSource().getQuotes({
    sessionId: 'qs',
    pickup,
    destination,
    partySize: 1,
    timeoutMs: 8000,
    locale: 'en-US',
  });
}

beforeEach(() => {
  clearRideLensEnv();
  withEnv({ NODE_ENV: 'development', ENABLE_BIKE_SHARE: 'true' });
  mock.install();
});
afterEach(() => {
  mock.restore();
  clearRideLensEnv();
});

describe('BikeShareQuoteSource', () => {
  it('needs no credential', async () => {
    const { BikeShareQuoteSource } = await import('@/sources/bikeshare/BikeShareQuoteSource');
    const gate = new BikeShareQuoteSource().enablement();
    expect(gate.enabled).toBe(true);
    expect(gate.blockerCode).toBeNull();
  });

  it('prices a trip from live stations and the published plan', async () => {
    installFeeds();
    const result = await quote(UNION_SQ, WASHINGTON_SQ);
    const q = result.quotes[0];

    expect(q).toBeDefined();
    expect(q?.provider).toBe('bikeshare');
    expect(q?.normalizedCategory).toBe('BIKE');
    expect(q?.sourceMethod).toBe('OPEN_REALTIME_FEED');
    expect(q?.availability).toBe('AVAILABLE');
    // Unlock $4.99 plus per-minute; never free, never a bare unlock.
    expect(q?.priceMinMinor).toBeGreaterThan(499);
  });

  it('picks the cheaper classic plan rather than the e-bike one', async () => {
    installFeeds();
    const q = (await quote(UNION_SQ, WASHINGTON_SQ)).quotes[0];
    expect(String(q?.metadata.planName)).toMatch(/SINGLE RIDE/);
    expect(String(q?.metadata.breakdown)).toContain('Unlock $4.99');
  });

  it('names a specific station with a specific number of bikes in it', async () => {
    installFeeds();
    const q = (await quote(UNION_SQ, WASHINGTON_SQ)).quotes[0];
    expect(q?.metadata.startStation).toBe('University Pl & E 14 St');
    expect(q?.metadata.endStation).toBe('Sullivan St & Washington Sq');
    expect(q?.metadata.endDocks).toBe(37);
    // The winning plan is named "SINGLE RIDE" and says nothing about a vehicle,
    // so the quote does not claim one either: any of the 12 will do. The e-bike
    // count is still reported, because the feed states it.
    expect(q?.metadata.vehicle).toBe('bike');
    expect(q?.metadata.startVehiclesAvailable).toBe(12);
    expect(q?.metadata.startBikesTotal).toBe(12);
    expect(q?.metadata.startEbikes).toBe(2);
    // The pickup ETA is a real walk to that station, not a guess.
    expect(q?.pickupEtaSeconds).toBeGreaterThan(0);
  });

  it('will not price a monthly pass as a single ride', async () => {
    // Philadelphia's Indego publishes only passes in system_pricing_plans:
    // "Indego30" at $21.60, "IndegoFlex" at $10.00, none with a per-minute
    // rate. Picking the cheapest and printing it would put a subscription on
    // screen labelled as a bike trip.
    installFeeds({
      plans: [
        {
          plan_id: 'indego_30',
          name: 'Indego30',
          currency: 'USD',
          price: 21.6,
          is_taxable: false,
          description: '',
        },
        {
          plan_id: 'indego_flex',
          name: 'IndegoFlex',
          currency: 'USD',
          price: 10.0,
          is_taxable: false,
          description: '',
        },
      ],
    });
    const res = await quote(UNION_SQ, WASHINGTON_SQ);
    expect(res.quotes).toHaveLength(0);
    expect(res.warnings.join(' ')).toMatch(/no single-ride price/i);
  });

  it('never prices a bike trip off a scooter plan', async () => {
    // Divvy publishes a bike plan and a scooter plan at the same $1.00 unlock
    // but $0.20 and $0.44 a minute. Which came first in the feed was the only
    // thing standing between the cheaper fare and one twice as high.
    installFeeds({
      plans: [
        {
          plan_id: 'SCOOTER_SINGLE_RIDE',
          name: 'SCOOTER SINGLE RIDE',
          currency: 'USD',
          price: 1.0,
          is_taxable: false,
          description: '$1.00 unlock fee, $0.44 per minute.',
        },
        {
          plan_id: 'BIKE_SINGLE_RIDE',
          name: 'BIKE SINGLE RIDE',
          currency: 'USD',
          price: 1.0,
          is_taxable: false,
          description: '$1.00 unlock fee, $0.20 per minute.',
        },
      ],
    });
    const q = (await quote(UNION_SQ, WASHINGTON_SQ)).quotes[0];
    expect(String(q?.metadata.planName)).toBe('BIKE SINGLE RIDE');
    expect(String(q?.metadata.breakdown)).toContain('$0.20/min');
  });

  it('holds an e-bike-only operator to actual e-bike supply', async () => {
    // Citi Bike publishes exactly one plan and it is the e-bike one, so this is
    // the real shape of the live feed, not a contrived case. A rack of classic
    // bikes cannot deliver the trip that price describes.
    installFeeds({
      plans: [pricing.data.plans[1]],
      status: statusWith({ num_bikes_available: 12, num_ebikes_available: 0 }),
    });
    const res = await quote(UNION_SQ, WASHINGTON_SQ);
    expect(res.quotes).toHaveLength(0);
    expect(res.warnings.join(' ')).toContain('e-bike');
  });

  it('quotes the e-bike plan when an e-bike is genuinely there', async () => {
    installFeeds({
      plans: [pricing.data.plans[1]],
      status: statusWith({ num_bikes_available: 12, num_ebikes_available: 3 }),
    });
    const q = (await quote(UNION_SQ, WASHINGTON_SQ)).quotes[0];
    expect(q?.metadata.vehicle).toBe('e-bike');
    expect(q?.metadata.startVehiclesAvailable).toBe(3);
    expect(q?.availability).toBe('AVAILABLE');
  });

  it("carries the feed timestamp and TTL so freshness is the operator's own", async () => {
    installFeeds();
    const q = (await quote(UNION_SQ, WASHINGTON_SQ)).quotes[0];
    expect(q?.providerTimestamp).toBe(new Date(1788499359 * 1000).toISOString());
    expect(q?.metadata.feedTtlSeconds).toBe(60);
    expect(q?.freshness).toBe('LIVE');
  });

  it('refuses to quote when no station has a bike', async () => {
    mock
      .on('gbfs.citibikenyc.com/gbfs/gbfs.json', feeds())
      .on('station_information.json', stationInfo)
      .on('station_status.json', stationStatus({ num_bikes_available: 0, num_ebikes_available: 0 }))
      .on('system_pricing_plans.json', pricing)
      .on(OSRM, { code: 'Ok', routes: [{ distance: 1200, duration: 300 }] });

    const result = await quote(UNION_SQ, WASHINGTON_SQ);
    expect(result.quotes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/bike available/i);
  });

  it('returns nothing outside a covered system, without calling any feed', async () => {
    const result = await quote(LONDON, LONDON);
    expect(result.quotes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/No bike-share system covers/);
    expect(mock.calls).toHaveLength(0);
  });

  it('degrades to a warning when the feed is unreachable', async () => {
    mock
      .onError('gbfs.citibikenyc.com')
      .on(OSRM, { code: 'Ok', routes: [{ distance: 1200, duration: 300 }] });
    const result = await quote(UNION_SQ, WASHINGTON_SQ);
    expect(result.quotes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/did not respond/i);
  });

  it('is off when an operator disables it', async () => {
    withEnv({ NODE_ENV: 'development', ENABLE_BIKE_SHARE: 'false' });
    await expect(quote(UNION_SQ, WASHINGTON_SQ)).rejects.toMatchObject({ kind: 'DISABLED' });
  });

  it('offers no booking link, because there is nowhere to send anyone', async () => {
    installFeeds();
    const q = (await quote(UNION_SQ, WASHINGTON_SQ)).quotes[0];
    expect(q?.bookingHandoff?.kind).toBe('INFO_ONLY');
    expect(q?.bookingHandoff?.url).toBeNull();
  });
});
