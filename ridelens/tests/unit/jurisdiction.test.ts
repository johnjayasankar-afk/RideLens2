/**
 * A rate card must apply exactly where its regulator governs.
 *
 * Market matching used to be a bounding box, and boxes do not respect state
 * lines: a rectangle around New York City reaches across the Hudson, so a
 * pickup in Newark or Jersey City matched New York and was quoted on the TLC
 * meter. Evanston got Chicago's. Those were not gaps — they were confident
 * wrong answers, which is the one failure mode this product exists to prevent.
 *
 * Every coordinate below is a real place. INSIDE means the named regulator
 * genuinely sets fares there; OUTSIDE means somebody else does.
 */
import { describe, expect, it } from 'vitest';
import { marketBounds, tariffForPickup } from '@/sources/ratecard/tariffs';
import { inBBox, inPolygon } from '@/domain/geo';
import { computeFare } from '@/domain/tariff';

const INSIDE: Array<[string, number, number, string]> = [
  // New York City, five boroughs.
  ['Times Square', 40.758, -73.9855, 'New York City'],
  ['Wall Street', 40.7069, -74.0113, 'New York City'],
  ['Inwood, upper Manhattan', 40.8677, -73.9212, 'New York City'],
  ['Riverdale, the Bronx', 40.8901, -73.9126, 'New York City'],
  ['Wakefield, north Bronx', 40.9034, -73.8574, 'New York City'],
  ['Downtown Brooklyn', 40.6928, -73.9903, 'New York City'],
  ['Coney Island', 40.5755, -73.9707, 'New York City'],
  ['Flushing, Queens', 40.7654, -73.8318, 'New York City'],
  ['St George, Staten Island', 40.6437, -74.0765, 'New York City'],
  ['JFK', 40.6413, -73.7781, 'New York City'],
  ['LaGuardia', 40.7769, -73.874, 'New York City'],

  // Chicago.
  ['the Loop', 41.8827, -87.6233, 'Chicago'],
  ['Rogers Park', 41.9994, -87.6695, 'Chicago'],
  ['Hyde Park', 41.7943, -87.5907, 'Chicago'],
  ["O'Hare", 41.9742, -87.9073, 'Chicago'],
  ['Midway', 41.7868, -87.7522, 'Chicago'],

  // District of Columbia.
  ['the Capitol', 38.8899, -77.0091, 'Washington, DC'],
  ['Dupont Circle', 38.9097, -77.0434, 'Washington, DC'],
  ['Anacostia', 38.8656, -76.9846, 'Washington, DC'],

  // San Francisco.
  ['Union Square SF', 37.788, -122.4075, 'San Francisco'],
  ['the Mission', 37.7599, -122.4148, 'San Francisco'],
  ['SFO', 37.6213, -122.379, 'San Francisco'],

  // Boston and the meter-rate communities.
  ['Boston Common', 42.355, -71.0656, 'Boston'],
  ['Cambridge', 42.3736, -71.1097, 'Boston'],
  ['Logan', 42.3656, -71.0096, 'Boston'],

  // Philadelphia.
  ['City Hall, Philadelphia', 39.9526, -75.1652, 'Philadelphia'],
  ['PHL', 39.8744, -75.2424, 'Philadelphia'],

  // Seattle and King County.
  ['downtown Seattle', 47.6062, -122.3321, 'Seattle'],
  ['Sea-Tac', 47.4502, -122.3088, 'Seattle'],
];

const OUTSIDE: Array<[string, number, number, string]> = [
  // New Jersey is not New York, however close the rectangle came.
  ['Newark, NJ', 40.7357, -74.1724, 'across the Hudson, NJ-regulated'],
  ['Jersey City, NJ', 40.7178, -74.0431, 'across the Hudson'],
  ['Hoboken, NJ', 40.744, -74.0324, 'across the Hudson'],
  ['Bayonne, NJ', 40.6687, -74.1143, 'across the Kill Van Kull'],
  ['Newark Airport', 40.6895, -74.1745, 'in New Jersey'],

  // North and east of the city line.
  ['Yonkers, NY', 40.9312, -73.8988, 'Westchester'],
  ['Scarsdale, NY', 41.0051, -73.7846, 'Westchester — the reported case'],
  ['White Plains, NY', 41.034, -73.7629, 'Westchester'],
  ['Great Neck, NY', 40.7868, -73.7285, 'Nassau'],

  // Illinois municipalities with their own licensing.
  ['Evanston, IL', 42.0451, -87.6877, 'north of Howard St'],
  ['Oak Park, IL', 41.885, -87.7845, 'west of the city line'],
  ['Cicero, IL', 41.8456, -87.7539, 'its own town'],

  // Virginia and Maryland are not the District.
  ['Reagan National', 38.8512, -77.0402, 'Arlington, Virginia'],
  ['Dulles', 38.9531, -77.4565, 'Loudoun County, Virginia'],
  ['Arlington, VA', 38.8816, -77.091, 'Virginia'],
  ['Bethesda, MD', 38.9847, -77.0947, 'Maryland'],

  // The Bay is bigger than the city.
  ['Oakland, CA', 37.8044, -122.2712, 'Alameda County'],
  ['Daly City, CA', 37.6879, -122.4702, 'San Mateo County'],
  ['Berkeley, CA', 37.8715, -122.273, 'Alameda County'],

  // Nowhere near a covered market.
  ['Denver, CO', 39.7392, -104.9903, 'no card'],
  ['Austin, TX', 30.2672, -97.7431, 'no card'],
  ['London', 51.5072, -0.1276, 'a different country'],
];

describe('a card applies only where its regulator governs', () => {
  it.each(INSIDE)('%s is priced by %s', (_name, lat, lng, market) => {
    expect(tariffForPickup({ lat, lng })?.marketName).toBe(market);
  });

  it.each(OUTSIDE)('%s gets no card (%s)', (_name, lat, lng, _why) => {
    expect(tariffForPickup({ lat, lng })).toBeNull();
  });

  it('never matches two markets for one pickup', () => {
    for (const [, lat, lng] of INSIDE) {
      const matches = marketBounds().filter(
        (m) => inBBox({ lat, lng }, m.bbox) && m.rings.some((r) => inPolygon({ lat, lng }, r)),
      );
      expect(matches.length, `${lat},${lng} matched ${matches.length} markets`).toBe(1);
    }
  });

  it('keeps every ring inside its own bounding box', () => {
    // The box is a cheap pre-filter, so a ring poking outside it would make
    // part of the market silently unreachable.
    for (const m of marketBounds()) {
      for (const ring of m.rings) {
        for (const [lng, lat] of ring) {
          expect(
            inBBox({ lat, lng }, m.bbox),
            `${m.tariff.marketName}: ring point ${lat},${lng} is outside the box`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps every zone a card names inside that card’s own market', () => {
    for (const m of marketBounds()) {
      for (const zone of m.tariff.zones) {
        const points =
          zone.shape.kind === 'circle'
            ? [zone.shape.circle.center]
            : zone.shape.ring.map(([lng, lat]) => ({ lat, lng }));
        for (const p of points) {
          expect(
            inBBox(p, m.bbox),
            `${m.tariff.marketName}: zone "${zone.id}" at ${p.lat},${p.lng} is outside the market`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('leaving the city the meter is written for', () => {
  const MI = 1609.344;
  const MIDDAY = new Date('2026-09-08T15:00:00Z');
  const CHELSEA = { lat: 40.7449, lng: -74.006 };

  /** A crude polyline from a to b, dense enough to find the city line. */
  function line(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
    steps = 200,
  ): Array<[number, number]> {
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps;
      return [a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t] as [number, number];
    });
  }

  function nyc() {
    const t = tariffForPickup(CHELSEA);
    if (!t) throw new Error('NYC tariff missing');
    return t;
  }

  it('doubles the distance rate beyond the city line, as Rate #04 says', () => {
    const t = nyc();
    const scarsdale = { lat: 41.0051, lng: -73.7846 };
    const route = {
      distanceMeters: 24 * MI,
      durationSeconds: 2700,
      coordinates: line(CHELSEA, scarsdale),
    };
    const fare = computeFare(t, route, {
      pickup: CHELSEA,
      destination: scarsdale,
      at: MIDDAY,
    });

    expect(fare.kind).toBe('METERED');
    const inside = fare.components.find((c) => c.key === 'distance');
    const outside = fare.components.find((c) => c.key === 'distance_out_of_city');
    expect(inside, 'no in-city distance component').toBeDefined();
    expect(outside, 'no out-of-city distance component').toBeDefined();

    // The same mileage costs twice as much beyond the line, so the out-of-city
    // rate per unit must be exactly double.
    const unitsIn = Number(/^(\d+)/.exec(inside!.label)?.[1]);
    const unitsOut = Number(/^(\d+)/.exec(outside!.label)?.[1]);
    expect(inside!.amountMinor / unitsIn).toBe(t.perUnitMinor);
    expect(outside!.amountMinor / unitsOut).toBe(t.perUnitMinor * 2);
    expect(fare.explanation.join(' ')).toContain('double');
  });

  it('meters a trip that stays inside the city at the plain rate', () => {
    const t = nyc();
    const midtown = { lat: 40.758, lng: -73.9855 };
    const fare = computeFare(
      t,
      { distanceMeters: 3 * MI, durationSeconds: 700, coordinates: line(CHELSEA, midtown) },
      { pickup: CHELSEA, destination: midtown, at: MIDDAY },
    );
    expect(fare.kind).toBe('METERED');
    expect(fare.components.find((c) => c.key === 'distance_out_of_city')).toBeUndefined();
  });

  it('refuses to price a trip past Westchester and Nassau, where the fare is negotiated', () => {
    const t = nyc();
    const newHaven = { lat: 41.3083, lng: -72.9279 };
    const fare = computeFare(
      t,
      { distanceMeters: 78 * MI, durationSeconds: 6000, coordinates: line(CHELSEA, newHaven) },
      { pickup: CHELSEA, destination: newHaven, at: MIDDAY },
    );
    expect(fare.kind).toBe('NEGOTIATED');
    expect(fare.minMinor).toBe(0);
    expect(fare.components).toEqual([]);
    expect(fare.explanation.join(' ')).toMatch(/negotiated/i);
  });

  it('still prices a destination the card names, wherever it sits', () => {
    // Newark Airport is in New Jersey and outside the service area, but the TLC
    // publishes a rule for it — metered fare plus a $20 surcharge — so it is
    // neither doubled nor negotiated.
    const t = nyc();
    const ewr = { lat: 40.6895, lng: -74.1745 };
    const fare = computeFare(
      t,
      { distanceMeters: 12 * MI, durationSeconds: 1800, coordinates: line(CHELSEA, ewr) },
      { pickup: CHELSEA, destination: ewr, at: MIDDAY },
    );
    expect(fare.kind).toBe('METERED');
    expect(fare.components.find((c) => c.key === 'surcharge:ewr')?.amountMinor).toBe(2000);
    expect(fare.components.find((c) => c.key === 'distance_out_of_city')).toBeUndefined();
  });

  it('will not guess the split when there is no measured route', () => {
    const t = nyc();
    const scarsdale = { lat: 41.0051, lng: -73.7846 };
    const fare = computeFare(
      t,
      { distanceMeters: 24 * MI, durationSeconds: 2700 },
      { pickup: CHELSEA, destination: scarsdale, at: MIDDAY },
    );
    // Charging the whole distance at the inside rate would understate a fare
    // the regulator says doubles, so it declines instead.
    expect(fare.kind).toBe('NEGOTIATED');
    expect(fare.explanation.join(' ')).toContain('city line');
  });
});
