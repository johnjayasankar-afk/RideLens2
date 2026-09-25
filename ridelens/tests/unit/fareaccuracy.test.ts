/**
 * The accuracy pass.
 *
 * Every case here corresponds to a real difference between what RideLens used
 * to print and what a passenger is actually charged. They are grouped by the
 * kind of mistake rather than by city, because the mistakes rhyme: a charge
 * that only applies in one direction, a rule that switches off on a holiday, a
 * line on the card that was simply never modelled.
 */

import { describe, expect, it } from 'vitest';
import { isUsPublicHoliday, localTimeIn } from '@/domain/geo';
import { computeFare } from '@/domain/tariff';
import { tollsOnRoute, TOLL_FACILITIES } from '@/domain/tolls';
import { allTariffs, marketBounds, tariffForPickup } from '@/sources/ratecard/tariffs';

const MI = 1609.344;

const NYC_MIDTOWN = { lat: 40.7549, lng: -73.984 };
const NYC_PRINCE = { lat: 40.7233, lng: -73.9959 };
const JFK = { lat: 40.6413, lng: -73.7781 };
const EWR = { lat: 40.6895, lng: -74.1745 };
const LGA = { lat: 40.7769, lng: -73.874 };
const CHICAGO_LOOP = { lat: 41.8827, lng: -87.6233 };
const ORD = { lat: 41.9742, lng: -87.9073 };
const DC_CAPITOL = { lat: 38.8899, lng: -77.0091 };
const BOSTON_COMMON = { lat: 42.355, lng: -71.0656 };
const BOS = { lat: 42.3656, lng: -71.0096 };

function tariff(at: { lat: number; lng: number }) {
  const t = tariffForPickup(at);
  if (!t) throw new Error('no tariff');
  return t;
}

const ROUTE = { distanceMeters: 6 * MI, durationSeconds: 1500 };
const MIDDAY = new Date('2026-09-08T15:00:00Z'); // 11:00 ET, a plain Tuesday

describe('charges that only apply in one direction', () => {
  it("does not bill Newark's $20 on a trip out of Newark", () => {
    const t = tariff(NYC_MIDTOWN);
    const toEwr = computeFare(t, ROUTE, {
      pickup: NYC_MIDTOWN,
      destination: EWR,
      at: MIDDAY,
    });
    const fromEwr = computeFare(t, ROUTE, {
      pickup: EWR,
      destination: NYC_MIDTOWN,
      at: MIDDAY,
    });
    expect(toEwr.components.find((c) => c.key === 'surcharge:ewr')?.amountMinor).toBe(2000);
    expect(fromEwr.components.find((c) => c.key === 'surcharge:ewr')).toBeUndefined();
  });

  it('bills the LaGuardia $5 in both directions, because the rule says both', () => {
    const t = tariff(NYC_MIDTOWN);
    const out = computeFare(t, ROUTE, { pickup: NYC_MIDTOWN, destination: LGA, at: MIDDAY });
    const back = computeFare(t, ROUTE, { pickup: LGA, destination: NYC_MIDTOWN, at: MIDDAY });
    expect(out.components.find((c) => c.key === 'surcharge:lga')?.amountMinor).toBe(500);
    expect(back.components.find((c) => c.key === 'surcharge:lga')?.amountMinor).toBe(500);
  });

  it("bills Boston's tunnel toll only on the way to Logan", () => {
    const t = tariff(BOSTON_COMMON);
    const out = computeFare(t, ROUTE, {
      pickup: BOSTON_COMMON,
      destination: BOS,
      at: MIDDAY,
    });
    const back = computeFare(t, ROUTE, {
      pickup: BOS,
      destination: BOSTON_COMMON,
      at: MIDDAY,
    });
    expect(out.components.find((c) => c.key === 'surcharge:logan_toll')?.amountMinor).toBe(275);
    expect(back.components.find((c) => c.key === 'surcharge:logan_toll')).toBeUndefined();
  });
});

describe('charges that were on the card but not in the code', () => {
  it('drops the DC emergency fuel surcharge, which is not currently declared', () => {
    const t = tariff(DC_CAPITOL);
    expect(t.surcharges.find((s) => s.id === 'fuel')).toBeUndefined();
    const fare = computeFare(t, ROUTE, {
      pickup: DC_CAPITOL,
      destination: { lat: 38.9072, lng: -77.0369 },
      at: MIDDAY,
    });
    expect(fare.components.find((c) => c.key === 'surcharge:fuel')).toBeUndefined();
    // The $0.50 passenger surcharge is real and stays.
    expect(fare.components.find((c) => c.key === 'surcharge:passenger')?.amountMinor).toBe(50);
  });

  it('charges Chicago $1.00 for the second rider and $0.50 for each one after', () => {
    const t = tariff(CHICAGO_LOOP);
    const ctx = { pickup: CHICAGO_LOOP, destination: ORD, at: MIDDAY };
    const solo = computeFare(t, ROUTE, ctx);
    const pair = computeFare(t, ROUTE, { ...ctx, passengers: 2 });
    const four = computeFare(t, ROUTE, { ...ctx, passengers: 4 });
    expect(pair.minMinor - solo.minMinor).toBe(100);
    expect(four.minMinor - solo.minMinor).toBe(200);
  });

  it('charges DC $1.00 per additional passenger', () => {
    const t = tariff(DC_CAPITOL);
    const ctx = { pickup: DC_CAPITOL, destination: { lat: 38.9072, lng: -77.0369 }, at: MIDDAY };
    const solo = computeFare(t, ROUTE, ctx);
    const three = computeFare(t, ROUTE, { ...ctx, passengers: 3 });
    expect(three.minMinor - solo.minMinor).toBe(200);
  });

  it('lets two ride free in Seattle, which charges "per passenger over two"', () => {
    const SEATTLE_DOWNTOWN = { lat: 47.6062, lng: -122.3321 };
    const t = tariff(SEATTLE_DOWNTOWN);
    const ctx = {
      pickup: SEATTLE_DOWNTOWN,
      destination: { lat: 47.6205, lng: -122.3493 },
      at: MIDDAY,
    };
    const solo = computeFare(t, ROUTE, ctx);
    const pair = computeFare(t, ROUTE, { ...ctx, passengers: 2 });
    const three = computeFare(t, ROUTE, { ...ctx, passengers: 3 });
    const four = computeFare(t, ROUTE, { ...ctx, passengers: 4 });
    // Two people ride for the base fare here, unlike Chicago or DC.
    expect(pair.minMinor).toBe(solo.minMinor);
    expect(three.minMinor - solo.minMinor).toBe(50);
    expect(four.minMinor - solo.minMinor).toBe(100);
  });

  it('leaves party size inert where the city does not charge for it', () => {
    const t = tariff(NYC_MIDTOWN);
    const ctx = { pickup: NYC_MIDTOWN, destination: NYC_PRINCE, at: MIDDAY };
    expect(computeFare(t, ROUTE, { ...ctx, passengers: 4 }).minMinor).toBe(
      computeFare(t, ROUTE, ctx).minMinor,
    );
  });
});

describe('holidays', () => {
  it('identifies the federal calendar, fixed and floating', () => {
    const on = (y: number, m: number, d: number) =>
      isUsPublicHoliday({ year: y, month: m, day: d });
    expect(on(2026, 7, 4)).toBe(true); // Independence Day
    expect(on(2026, 12, 25)).toBe(true); // Christmas
    expect(on(2026, 6, 19)).toBe(true); // Juneteenth
    expect(on(2026, 11, 26)).toBe(true); // Thanksgiving, 4th Thursday
    expect(on(2026, 11, 19)).toBe(false); // 3rd Thursday is not
    expect(on(2026, 5, 25)).toBe(true); // Memorial Day, last Monday
    expect(on(2026, 5, 18)).toBe(false);
    expect(on(2026, 9, 7)).toBe(true); // Labor Day, 1st Monday
    expect(on(2026, 1, 19)).toBe(true); // MLK, 3rd Monday
    expect(on(2026, 9, 8)).toBe(false); // an ordinary Tuesday
  });

  it("suspends New York's rush-hour surcharge on a holiday", () => {
    const t = tariff(NYC_MIDTOWN);
    const ctx = { pickup: NYC_MIDTOWN, destination: NYC_PRINCE };
    // 17:00 ET on Thanksgiving 2026 (a Thursday), and on the Thursday before.
    const holiday = computeFare(t, ROUTE, { ...ctx, at: new Date('2026-11-26T22:00:00Z') });
    const ordinary = computeFare(t, ROUTE, { ...ctx, at: new Date('2026-11-19T22:00:00Z') });
    expect(ordinary.components.find((c) => c.key === 'surcharge:rush_metered')?.amountMinor).toBe(
      250,
    );
    expect(holiday.components.find((c) => c.key === 'surcharge:rush_metered')).toBeUndefined();
    expect(ordinary.minMinor - holiday.minMinor).toBe(250);
  });

  it('reads the holiday in the market timezone, not the server one', () => {
    // 02:00 UTC on 5 July is still 22:00 on 4 July in New York.
    const t = localTimeIn('America/New_York', new Date('2026-07-05T02:00:00Z'));
    expect(t.month).toBe(7);
    expect(t.day).toBe(4);
    expect(isUsPublicHoliday(t)).toBe(true);
  });
});

describe('tolls', () => {
  const throughMidtownTunnel: Array<[number, number]> = [
    [-73.9712, 40.7484],
    [-73.9601, 40.7434], // tunnel
    [-73.9435, 40.7442],
  ];
  const overQueensboro: Array<[number, number]> = [
    [-73.9712, 40.7484],
    [-73.9541, 40.7571], // free bridge
    [-73.9435, 40.7442],
  ];

  it('finds a tolled crossing the route actually goes through', () => {
    const found = tollsOnRoute('nyc', throughMidtownTunnel);
    expect(found.map((t) => t.id)).toEqual(['queens_midtown']);
    expect(found[0]?.amountMinor).toBe(694);
  });

  it('claims nothing for a route that took the free bridge', () => {
    expect(tollsOnRoute('nyc', overQueensboro)).toEqual([]);
  });

  it('does not apply one market’s crossings to another', () => {
    expect(tollsOnRoute('chicago', throughMidtownTunnel)).toEqual([]);
  });

  it('puts a toll at the top of the band and never in the floor', () => {
    const t = tariff(NYC_MIDTOWN);
    const ctx = { pickup: NYC_MIDTOWN, destination: JFK, at: MIDDAY };
    const free = computeFare(t, { ...ROUTE, coordinates: overQueensboro }, ctx);
    const tolled = computeFare(t, { ...ROUTE, coordinates: throughMidtownTunnel }, ctx);
    // The floor is the same: the driver might take the free bridge.
    expect(tolled.minMinor).toBe(free.minMinor);
    // The ceiling carries the toll, marked uncertain.
    expect(tolled.maxMinor - free.maxMinor).toBe(694);
    const line = tolled.components.find((c) => c.key === 'toll:queens_midtown');
    expect(line?.uncertain).toBe(true);
    expect(tolled.explanation.join(' ')).toContain('Queens-Midtown Tunnel');
  });

  it('is unchanged when no geometry is supplied', () => {
    const t = tariff(NYC_MIDTOWN);
    const ctx = { pickup: NYC_MIDTOWN, destination: JFK, at: MIDDAY };
    const fare = computeFare(t, ROUTE, ctx);
    expect(fare.components.some((c) => c.key.startsWith('toll:'))).toBe(false);
    expect(fare.explanation.join(' ')).toContain('Tolls and gratuity are not included');
  });

  it('names an authority for every facility, so a wrong toll is traceable', () => {
    const markets = new Set(allTariffs().map((t) => t.marketId));
    for (const f of TOLL_FACILITIES) {
      expect(f.authority.length).toBeGreaterThan(3);
      expect(f.amountMinor).toBeGreaterThan(0);
      expect(Number.isInteger(f.amountMinor)).toBe(true);
      expect(f.radiusMeters).toBeGreaterThan(100);
      // A toll for a market nobody can be picked up in would never fire.
      expect(markets.has(f.marketId)).toBe(true);
    }
  });
});

describe('figures that expire on purpose', () => {
  const PHL = { lat: 39.8744, lng: -75.2424 };
  const CITY_HALL = { lat: 39.9526, lng: -75.1652 };

  it('applies Philadelphia’s monthly fuel surcharge while it is current', () => {
    const t = tariff(CITY_HALL);
    const inSeptember = computeFare(t, ROUTE, {
      pickup: CITY_HALL,
      destination: { lat: 39.9656, lng: -75.181 },
      at: new Date('2026-09-15T16:00:00Z'),
    });
    expect(inSeptember.components.find((c) => c.key === 'surcharge:fuel')?.amountMinor).toBe(130);
  });

  it('drops it once the published figure has aged out, and says so', () => {
    const t = tariff(CITY_HALL);
    const inNovember = computeFare(t, ROUTE, {
      pickup: CITY_HALL,
      destination: { lat: 39.9656, lng: -75.181 },
      at: new Date('2026-11-15T16:00:00Z'),
    });
    expect(inNovember.components.find((c) => c.key === 'surcharge:fuel')).toBeUndefined();
    expect(inNovember.explanation.join(' ')).toContain('passed its date');
  });

  it('prices the PHL flat fare in both directions and charges egress only on the way out', () => {
    const t = tariff(CITY_HALL);
    const out = computeFare(t, ROUTE, {
      pickup: CITY_HALL,
      destination: PHL,
      at: new Date('2026-09-15T16:00:00Z'),
    });
    const back = computeFare(t, ROUTE, {
      pickup: PHL,
      destination: CITY_HALL,
      at: new Date('2026-09-15T16:00:00Z'),
    });
    expect(out.kind).toBe('FLAT');
    expect(back.kind).toBe('FLAT');
    expect(out.components.find((c) => c.key === 'flat:phl_center_city')?.amountMinor).toBe(3200);
    // Egress is metered-only, so a flat-fare trip out of PHL does not pay it.
    expect(back.components.find((c) => c.key === 'surcharge:airport_egress')).toBeUndefined();
  });
});

describe('how the card reads', () => {
  it('writes every shipped distance unit as a fraction, not a float', () => {
    // Boston bills per 1/7 mile and the label read "first 0.14285714285714285
    // mi" — true, and unlike anything a rate card has ever printed.
    for (const t of allTariffs()) {
      for (const fare of [
        computeFare(t, ROUTE, {
          pickup: { lat: t.zones[0]?.shape.kind === 'circle' ? 0 : 0, lng: 0 },
          destination: { lat: 0, lng: 0 },
          at: MIDDAY,
        }),
      ]) {
        for (const c of fare.components) {
          expect(c.label, `${t.marketName}: "${c.label}"`).not.toMatch(/\d\.\d{4,}/);
        }
      }
    }
  });
});

describe('market coverage', () => {
  /**
   * A card is selected by the pickup point, so a zone the card names but the
   * box excludes is unreachable: the airport surcharge can never fire, and — far
   * worse — a rider standing at that airport gets no fare at all. San Francisco
   * and Washington both shipped that way.
   */
  it('contains every zone each card names inside that card’s own bounding box', () => {
    for (const { tariff: t, bbox } of marketBounds()) {
      for (const zone of t.zones) {
        const points =
          zone.shape.kind === 'circle'
            ? [zone.shape.circle.center]
            : zone.shape.ring.map(([lng, lat]) => ({ lat, lng }));
        for (const p of points) {
          const inside =
            p.lat >= bbox.minLat &&
            p.lat <= bbox.maxLat &&
            p.lng >= bbox.minLng &&
            p.lng <= bbox.maxLng;
          expect(
            inside,
            `${t.marketName}: zone "${zone.id}" at ${p.lat},${p.lng} is outside the market box`,
          ).toBe(true);
        }
      }
    }
  });

  it('answers for a pickup at every airport its own regulator governs', () => {
    // EWR and Dulles are deliberately absent. Newark Airport is in New Jersey
    // and a New York yellow cab may not pick up there; Dulles is in Virginia
    // and the DC card names no airport at all. Both used to match — the market
    // boxes were rectangles that reached across state lines — and both were
    // quoted on a rate card that does not govern them. See jurisdiction.test.ts.
    const airports = [
      { name: 'JFK', at: JFK, market: 'New York City' },
      { name: 'LGA', at: LGA, market: 'New York City' },
      { name: 'ORD', at: ORD, market: 'Chicago' },
      { name: 'SFO', at: { lat: 37.6213, lng: -122.379 }, market: 'San Francisco' },
      { name: 'BOS', at: BOS, market: 'Boston' },
      { name: 'PHL', at: { lat: 39.8744, lng: -75.2424 }, market: 'Philadelphia' },
      { name: 'SEA', at: { lat: 47.4502, lng: -122.3088 }, market: 'Seattle' },
    ];
    for (const a of airports) {
      expect(tariffForPickup(a.at)?.marketName, `wrong market for ${a.name}`).toBe(a.market);
    }
    expect(tariffForPickup(EWR), 'EWR is in New Jersey').toBeNull();
    expect(tariffForPickup({ lat: 38.9531, lng: -77.4565 }), 'Dulles is in Virginia').toBeNull();
  });
});
