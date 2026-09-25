import { describe, expect, it } from 'vitest';
import {
  MAX_BIKE_METERS,
  MAX_WALK_METERS,
  availableOf,
  nearestWithBike,
  nearestWithDock,
  planBikeTrip,
  priceBikeTrip,
  type StationLike,
} from '@/domain/bike';

const station = (
  over: Partial<StationLike> & { id: string; lat: number; lng: number },
): StationLike => ({
  name: `Station ${over.id}`,
  bikesAvailable: 5,
  ebikesAvailable: 0,
  docksAvailable: 5,
  renting: true,
  returning: true,
  ...over,
});

const A = { lat: 40.7359, lng: -73.9911 }; // Union Square
const B = { lat: 40.7308, lng: -73.9973 }; // Washington Square

describe('station selection', () => {
  it('picks the nearest station that actually has a bike', () => {
    const stations = [
      station({ id: 'empty', lat: 40.7359, lng: -73.9912, bikesAvailable: 0, ebikesAvailable: 0 }),
      station({ id: 'stocked', lat: 40.7362, lng: -73.9915 }),
    ];
    expect(nearestWithBike(A, stations)?.station.id).toBe('stocked');
  });

  it('counts an e-bike as a bike', () => {
    const stations = [
      station({ id: 'ebikes', lat: 40.736, lng: -73.9912, bikesAvailable: 0, ebikesAvailable: 3 }),
    ];
    expect(nearestWithBike(A, stations)?.station.id).toBe('ebikes');
  });

  it('ignores a station that is not renting or not returning', () => {
    expect(
      nearestWithBike(A, [station({ id: 'closed', lat: 40.736, lng: -73.9912, renting: false })]),
    ).toBeNull();
    expect(
      nearestWithDock(B, [station({ id: 'closed', lat: 40.731, lng: -73.9974, returning: false })]),
    ).toBeNull();
  });

  it('will not send anyone further than the walking cap', () => {
    // Roughly 2 km away.
    const far = station({ id: 'far', lat: 40.754, lng: -73.9911 });
    expect(nearestWithBike(A, [far])).toBeNull();
  });

  it('requires a free dock at the destination, not merely a station', () => {
    expect(
      nearestWithDock(B, [station({ id: 'full', lat: 40.731, lng: -73.9974, docksAvailable: 0 })]),
    ).toBeNull();
  });

  it('reports the walk in seconds as well as metres', () => {
    const pick = nearestWithBike(A, [station({ id: 's', lat: 40.7368, lng: -73.9911 })]);
    expect(pick).not.toBeNull();
    expect(pick!.walkMeters).toBeGreaterThan(0);
    expect(pick!.walkMeters).toBeLessThanOrEqual(MAX_WALK_METERS);
    expect(pick!.walkSeconds).toBeGreaterThan(0);
  });
});

describe('planBikeTrip', () => {
  const stations = [
    station({ id: 'start', lat: 40.7361, lng: -73.9913 }),
    station({ id: 'end', lat: 40.7309, lng: -73.9975 }),
  ];

  it('produces a trip with both ends grounded in real stations', () => {
    const result = planBikeTrip({ pickup: A, destination: B, rideMeters: 1200, stations });
    expect('trip' in result).toBe(true);
    if (!('trip' in result)) return;
    expect(result.trip.start.station.id).toBe('start');
    expect(result.trip.end.station.id).toBe('end');
    expect(result.trip.rideSecondsHigh).toBeGreaterThan(result.trip.rideSecondsLow);
    expect(result.trip.totalSecondsLow).toBeGreaterThan(result.trip.rideSecondsLow);
  });

  it('refuses, with a reason, when no bike is within reach', () => {
    const result = planBikeTrip({
      pickup: A,
      destination: B,
      rideMeters: 1200,
      stations: [station({ id: 'end', lat: 40.7309, lng: -73.9975 })],
    });
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toMatch(/bike available/i);
  });

  it('refuses, with a reason, when no dock is within reach', () => {
    const result = planBikeTrip({
      pickup: A,
      destination: B,
      rideMeters: 1200,
      stations: [station({ id: 'start', lat: 40.7361, lng: -73.9913 })],
    });
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toMatch(/free dock/i);
  });

  it('refuses a trip that is simply too far to cycle', () => {
    const result = planBikeTrip({
      pickup: A,
      destination: B,
      rideMeters: MAX_BIKE_METERS + 1,
      stations,
    });
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toMatch(/too far/i);
  });

  it('refuses when both ends resolve to the same station', () => {
    const one = [station({ id: 'only', lat: 40.7359, lng: -73.9911 })];
    const result = planBikeTrip({ pickup: A, destination: A, rideMeters: 100, stations: one });
    expect('reason' in result).toBe(true);
  });
});

describe('vehicle supply', () => {
  // GBFS nests e-bikes inside num_bikes_available. Citi Bike reporting 13 and 1
  // means twelve classic and one electric — thirteen vehicles, not fourteen.
  const mixed = station({ id: 'mixed', lat: 0, lng: 0, bikesAvailable: 13, ebikesAvailable: 1 });

  it('does not double-count e-bikes inside the total', () => {
    expect(availableOf(mixed, 'ANY')).toBe(13);
    expect(availableOf(mixed, 'EBIKE')).toBe(1);
    expect(availableOf(mixed, 'CLASSIC')).toBe(12);
  });

  it('reads a feed that reports the pools separately without losing bikes', () => {
    const disjoint = station({ id: 'd', lat: 0, lng: 0, bikesAvailable: 0, ebikesAvailable: 3 });
    expect(availableOf(disjoint, 'ANY')).toBe(3);
    expect(availableOf(disjoint, 'EBIKE')).toBe(3);
    expect(availableOf(disjoint, 'CLASSIC')).toBe(0);
  });

  it('will not send you to a rack of classic bikes for an e-bike price', () => {
    // Thirteen bikes, none electric. "Has a bike" is true; "has the bike we
    // priced" is not, and only the second one may produce a quote.
    const classicOnly = station({
      id: 'classic',
      lat: 40.736,
      lng: -73.9912,
      bikesAvailable: 13,
      ebikesAvailable: 0,
    });
    expect(nearestWithBike(A, [classicOnly], 'ANY')?.station.id).toBe('classic');
    expect(nearestWithBike(A, [classicOnly], 'EBIKE')).toBeNull();

    const result = planBikeTrip({
      pickup: A,
      destination: B,
      rideMeters: 1200,
      stations: [classicOnly, station({ id: 'end', lat: 40.7309, lng: -73.9975 })],
      vehicle: 'EBIKE',
    });
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toContain('e-bike');
  });

  it('carries the priced vehicle on the trip it produces', () => {
    const stations = [
      station({ id: 'start', lat: 40.7361, lng: -73.9913, ebikesAvailable: 2 }),
      station({ id: 'end', lat: 40.7309, lng: -73.9975 }),
    ];
    const result = planBikeTrip({
      pickup: A,
      destination: B,
      rideMeters: 1200,
      stations,
      vehicle: 'EBIKE',
    });
    expect('trip' in result).toBe(true);
    if ('trip' in result) expect(result.trip.vehicle).toBe('EBIKE');
  });
});

describe('priceBikeTrip', () => {
  const trip = {
    vehicle: 'ANY' as const,
    start: { station: station({ id: 'a', lat: 0, lng: 0 }), walkMeters: 100, walkSeconds: 74 },
    end: { station: station({ id: 'b', lat: 0, lng: 0 }), walkMeters: 120, walkSeconds: 89 },
    rideMeters: 1500,
    rideSecondsLow: 240,
    rideSecondsHigh: 420,
    totalSecondsLow: 403,
    totalSecondsHigh: 583,
  };

  it('charges the published unlock plus per-minute rate', () => {
    const fare = priceBikeTrip(trip, {
      unlockMinor: 499,
      perMinuteMinor: 41,
      currency: 'USD',
      name: 'Single ride',
    });
    // 4 min low, 7 min high.
    expect(fare.minMinor).toBe(499 + 4 * 41);
    expect(fare.maxMinor).toBe(499 + 7 * 41);
    expect(fare.maxMinor).toBeGreaterThan(fare.minMinor);
  });

  it('collapses to a point when a plan has no per-minute component', () => {
    const fare = priceBikeTrip(trip, {
      unlockMinor: 350,
      perMinuteMinor: null,
      currency: 'USD',
      name: 'Day pass',
    });
    expect(fare.minMinor).toBe(350);
    expect(fare.maxMinor).toBe(350);
  });

  it('stays in whole cents', () => {
    const fare = priceBikeTrip(trip, {
      unlockMinor: 100,
      perMinuteMinor: 19,
      currency: 'USD',
      name: 'Classic',
    });
    expect(Number.isInteger(fare.minMinor)).toBe(true);
    expect(Number.isInteger(fare.maxMinor)).toBe(true);
  });

  it('explains the arithmetic rather than just asserting a number', () => {
    const fare = priceBikeTrip(trip, {
      unlockMinor: 499,
      perMinuteMinor: 41,
      currency: 'USD',
      name: 'Single ride',
    });
    expect(fare.breakdown).toContain('Unlock $4.99');
    expect(fare.breakdown).toContain('$0.41/min');
  });
});
