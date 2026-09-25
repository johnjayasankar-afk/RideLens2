/**
 * Regulated fare computation.
 *
 * These assertions are transcribed from the regulators' published schedules.
 * A failure here means either the engine is wrong or a city changed its rate
 * card — both of which need a human, not a rewritten expectation.
 */
import { describe, expect, it } from 'vitest';
import { hm, inWindow, inPolygon, localTimeIn, type LocalTime } from '@/domain/geo';
import { computeFare, meterUnits, URBAN_FREE_FLOW_MPH } from '@/domain/tariff';
import { allTariffs, tariffForPickup } from '@/sources/ratecard/tariffs';

const MI = 1609.344;

// Reference points.
const PRINCE_ST = { lat: 40.7233, lng: -73.9959 }; // Manhattan, below 60th
const UPPER_WEST = { lat: 40.7871, lng: -73.9754 }; // Manhattan, above 60th
const HARLEM = { lat: 40.8116, lng: -73.9465 }; // Manhattan, above 96th
const JFK = { lat: 40.6413, lng: -73.7781 };
const LGA = { lat: 40.7769, lng: -73.874 };
const BROOKLYN = { lat: 40.6782, lng: -73.9442 };
const CHICAGO_LOOP = { lat: 41.8827, lng: -87.6233 };
const ORD = { lat: 41.9742, lng: -87.9073 };
const SF_UNION_SQ = { lat: 37.788, lng: -122.4075 };
const DC_CAPITOL = { lat: 38.8899, lng: -77.0091 };
const LONDON = { lat: 51.5072, lng: -0.1276 };

/** Tuesday 2pm New York — outside every time-based surcharge window. */
const OFF_PEAK = new Date('2026-09-08T18:00:00Z');
/** Tuesday 5pm New York — inside the weekday rush window. */
const RUSH = new Date('2026-09-08T21:00:00Z');
/** Tuesday 11pm New York — inside the overnight window. */
const NIGHT = new Date('2026-09-09T03:00:00Z');
/** Sunday 5pm New York — rush hour, but not a weekday. */
const SUNDAY_EVENING = new Date('2026-09-13T21:00:00Z');

function nyc() {
  const t = tariffForPickup(PRINCE_ST);
  if (!t) throw new Error('NYC tariff missing');
  return t;
}

describe('market selection', () => {
  it('selects a market from the pickup point', () => {
    expect(tariffForPickup(PRINCE_ST)?.marketId).toBe('nyc');
    expect(tariffForPickup(BROOKLYN)?.marketId).toBe('nyc');
    expect(tariffForPickup(CHICAGO_LOOP)?.marketId).toBe('chicago');
    expect(tariffForPickup(SF_UNION_SQ)?.marketId).toBe('sf');
    expect(tariffForPickup(DC_CAPITOL)?.marketId).toBe('dc');
  });

  it('returns nothing where no rate card is published, rather than guessing', () => {
    expect(tariffForPickup(LONDON)).toBeNull();
    expect(tariffForPickup({ lat: 39.7392, lng: -104.9903 })).toBeNull(); // Denver
  });

  it('every rate card carries its authority, source and verification date', () => {
    for (const t of allTariffs()) {
      expect(t.authority).toBeTruthy();
      expect(t.sourceUrl).toMatch(/^https:\/\//);
      expect(t.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.currency).toHaveLength(3);
    }
  });

  it('every published amount is an integer number of cents', () => {
    for (const t of allTariffs()) {
      const amounts = [
        t.initialChargeMinor,
        t.perUnitMinor,
        t.perSlowUnitMinor,
        ...t.flatFares.map((f) => f.amountMinor),
        ...t.surcharges.map((s) => s.amountMinor),
      ];
      for (const a of amounts) expect(Number.isInteger(a)).toBe(true);
    }
  });
});

describe('NYC flat fares', () => {
  it('prices JFK ↔ Manhattan at the exact regulated $70 plus mandatory surcharges', () => {
    const fare = computeFare(
      nyc(),
      { distanceMeters: 17.7 * MI, durationSeconds: 1920 },
      { pickup: PRINCE_ST, destination: JFK, at: OFF_PEAK },
    );
    // $70 flat + $1 improvement + $0.50 MTA + $2.50 congestion + $0.75 MTA toll
    expect(fare.kind).toBe('FLAT');
    expect(fare.minMinor).toBe(7475);
    // A rule is not a prediction: there is no band.
    expect(fare.maxMinor).toBe(fare.minMinor);
  });

  it('charges the flat fare regardless of distance, because that is the rule', () => {
    const short = computeFare(
      nyc(),
      { distanceMeters: 12 * MI, durationSeconds: 1200 },
      { pickup: PRINCE_ST, destination: JFK, at: OFF_PEAK },
    );
    const long = computeFare(
      nyc(),
      { distanceMeters: 25 * MI, durationSeconds: 3600 },
      { pickup: PRINCE_ST, destination: JFK, at: OFF_PEAK },
    );
    expect(short.minMinor).toBe(long.minMinor);
  });

  it('applies the $5 airport rush surcharge, not the $2.50 metered one', () => {
    const fare = computeFare(
      nyc(),
      { distanceMeters: 17.7 * MI, durationSeconds: 1920 },
      { pickup: PRINCE_ST, destination: JFK, at: RUSH },
    );
    expect(fare.minMinor).toBe(7975);
    expect(fare.components.some((c) => c.key === 'surcharge:rush_flat')).toBe(true);
  });

  it('does not apply the overnight surcharge to a flat fare', () => {
    const fare = computeFare(
      nyc(),
      { distanceMeters: 17.7 * MI, durationSeconds: 1920 },
      { pickup: PRINCE_ST, destination: JFK, at: NIGHT },
    );
    expect(fare.minMinor).toBe(7475);
  });

  it('works in both directions', () => {
    const out = computeFare(
      nyc(),
      { distanceMeters: 17.7 * MI, durationSeconds: 1920 },
      { pickup: PRINCE_ST, destination: JFK, at: OFF_PEAK },
    );
    const back = computeFare(
      nyc(),
      { distanceMeters: 17.7 * MI, durationSeconds: 1920 },
      { pickup: JFK, destination: PRINCE_ST, at: OFF_PEAK },
    );
    expect(back.minMinor).toBe(out.minMinor);
  });

  it('does not apply the flat fare between JFK and Brooklyn', () => {
    const fare = computeFare(
      nyc(),
      { distanceMeters: 12 * MI, durationSeconds: 1500 },
      { pickup: BROOKLYN, destination: JFK, at: OFF_PEAK },
    );
    expect(fare.kind).toBe('METERED');
  });
});

describe('NYC metered fares', () => {
  it('charges the initial unit plus one unit per fifth mile', () => {
    // 4 miles: 3.8 billable ÷ 0.2 = 19 units at 70c = $13.30, plus $3.00.
    const fare = computeFare(
      nyc(),
      { distanceMeters: 4 * MI, durationSeconds: 4 * 150 },
      { pickup: PRINCE_ST, destination: UPPER_WEST, at: OFF_PEAK },
    );
    expect(fare.components.find((c) => c.key === 'distance')?.amountMinor).toBe(1330);
    expect(fare.components.find((c) => c.key === 'initial')?.amountMinor).toBe(300);
  });

  it('rounds a partial unit up, the way a meter ticks', () => {
    // 1.05 miles: 0.85 billable ÷ 0.2 = 4.25 → 5 units.
    const fare = computeFare(
      nyc(),
      { distanceMeters: 1.05 * MI, durationSeconds: 200 },
      { pickup: PRINCE_ST, destination: UPPER_WEST, at: OFF_PEAK },
    );
    expect(fare.components.find((c) => c.key === 'distance')?.amountMinor).toBe(350);
  });

  it('adds a slow-traffic band only when the route runs slower than free flow', () => {
    const miles = 4;
    const freeFlowSeconds = (miles / URBAN_FREE_FLOW_MPH) * 3600;

    const fast = computeFare(
      nyc(),
      { distanceMeters: miles * MI, durationSeconds: Math.floor(freeFlowSeconds) },
      { pickup: PRINCE_ST, destination: UPPER_WEST, at: OFF_PEAK },
    );
    expect(fast.maxMinor).toBe(fast.minMinor);

    const slow = computeFare(
      nyc(),
      { distanceMeters: miles * MI, durationSeconds: Math.floor(freeFlowSeconds) + 600 },
      { pickup: PRINCE_ST, destination: UPPER_WEST, at: OFF_PEAK },
    );
    // 600 slow seconds = 10 units at 70c.
    expect(slow.maxMinor - slow.minMinor).toBe(700);
    expect(slow.components.some((c) => c.uncertain)).toBe(true);
  });

  it('applies the congestion surcharge only when the trip touches below 96th St', () => {
    const inZone = computeFare(
      nyc(),
      { distanceMeters: 3 * MI, durationSeconds: 700 },
      { pickup: PRINCE_ST, destination: UPPER_WEST, at: OFF_PEAK },
    );
    expect(inZone.components.some((c) => c.key === 'surcharge:congestion')).toBe(true);

    const outside = computeFare(
      nyc(),
      { distanceMeters: 3 * MI, durationSeconds: 700 },
      { pickup: HARLEM, destination: BROOKLYN, at: OFF_PEAK },
    );
    expect(outside.components.some((c) => c.key === 'surcharge:congestion')).toBe(false);
  });

  it('applies rush hour on weekdays but not at the weekend', () => {
    const route = { distanceMeters: 3 * MI, durationSeconds: 700 };
    const weekday = computeFare(nyc(), route, {
      pickup: PRINCE_ST,
      destination: UPPER_WEST,
      at: RUSH,
    });
    const sunday = computeFare(nyc(), route, {
      pickup: PRINCE_ST,
      destination: UPPER_WEST,
      at: SUNDAY_EVENING,
    });
    expect(weekday.minMinor - sunday.minMinor).toBe(250);
  });

  it('applies the overnight surcharge after 8pm', () => {
    const route = { distanceMeters: 3 * MI, durationSeconds: 700 };
    const day = computeFare(nyc(), route, {
      pickup: PRINCE_ST,
      destination: UPPER_WEST,
      at: OFF_PEAK,
    });
    const night = computeFare(nyc(), route, {
      pickup: PRINCE_ST,
      destination: UPPER_WEST,
      at: NIGHT,
    });
    expect(night.minMinor - day.minMinor).toBe(100);
  });

  it('adds the LaGuardia surcharge for airport trips', () => {
    const fare = computeFare(
      nyc(),
      { distanceMeters: 7.3 * MI, durationSeconds: 1080 },
      { pickup: PRINCE_ST, destination: LGA, at: OFF_PEAK },
    );
    expect(fare.components.find((c) => c.key === 'surcharge:lga')?.amountMinor).toBe(500);
    // LaGuardia has no flat fare — it is metered plus a surcharge.
    expect(fare.kind).toBe('METERED');
  });
});

describe('other markets', () => {
  it('prices a Chicago airport run on the July 2026 rate structure', () => {
    const t = tariffForPickup(CHICAGO_LOOP);
    if (!t) throw new Error('missing');
    // The 2026 increase: 31c per 1/9 mile, not the older 25c.
    expect(t.perUnitMinor).toBe(31);
    expect(t.slowUnitSeconds).toBe(45);

    const fare = computeFare(
      t,
      { distanceMeters: 19.9 * MI, durationSeconds: 2640 },
      { pickup: CHICAGO_LOOP, destination: ORD, at: OFF_PEAK },
    );
    // The departure tax "applies to taxi fares leaving the airports", so this
    // Loop-to-O'Hare run does not pay it. It was once charged in both
    // directions, which put $4 on every trip TO an airport.
    expect(fare.components.find((c) => c.key === 'surcharge:airport_departure')).toBeUndefined();

    const leaving = computeFare(
      t,
      { distanceMeters: 19.9 * MI, durationSeconds: 2640 },
      { pickup: ORD, destination: CHICAGO_LOOP, at: OFF_PEAK },
    );
    expect(
      leaving.components.find((c) => c.key === 'surcharge:airport_departure')?.amountMinor,
    ).toBe(400);
    // Sanity band for a Loop–O'Hare run under the new card.
    expect(fare.minMinor).toBeGreaterThan(5000);
    expect(fare.minMinor).toBeLessThan(7500);
  });

  it("honours Chicago's 3:30pm rush start rather than rounding to 4pm", () => {
    const t = tariffForPickup(CHICAGO_LOOP);
    if (!t) throw new Error('missing');
    const route = { distanceMeters: 3 * MI, durationSeconds: 700 };
    // 15:45 America/Chicago
    const at345 = new Date('2026-09-08T20:45:00Z');
    // 15:15 America/Chicago
    const at315 = new Date('2026-09-08T20:15:00Z');
    const inRush = computeFare(t, route, { pickup: CHICAGO_LOOP, destination: ORD, at: at345 });
    const before = computeFare(t, route, { pickup: CHICAGO_LOOP, destination: ORD, at: at315 });
    expect(inRush.minMinor - before.minMinor).toBe(250);
  });

  it('bills DC in eighth-mile increments rather than whole miles', () => {
    const t = tariffForPickup(DC_CAPITOL);
    if (!t) throw new Error('missing');
    expect(t.unitDistanceMiles).toBe(0.125);
    expect(t.perUnitMinor).toBe(32);
    // 32c × 8 reconstructs the published $2.56 per mile exactly.
    expect(t.perUnitMinor * 8).toBe(256);
  });

  it('charges the SFO fee on pickup only, because there is no drop-off fee', () => {
    const t = tariffForPickup(SF_UNION_SQ);
    if (!t) throw new Error('missing');
    const route = { distanceMeters: 14 * MI, durationSeconds: 1320 };
    const SFO = { lat: 37.6213, lng: -122.379 };

    // SFMTA: "SFO pick-up fee is $6.00 ... There is NO DROP-OFF FEE."
    const toAirport = computeFare(t, route, {
      pickup: SF_UNION_SQ,
      destination: SFO,
      at: OFF_PEAK,
    });
    expect(toAirport.components.find((c) => c.key === 'surcharge:sfo_pickup')).toBeUndefined();

    const fromAirport = computeFare(t, route, {
      pickup: SFO,
      destination: SF_UNION_SQ,
      at: OFF_PEAK,
    });
    expect(fromAirport.components.find((c) => c.key === 'surcharge:sfo_pickup')?.amountMinor).toBe(
      600,
    );
    expect(fromAirport.minMinor - toAirport.minMinor).toBe(600);

    // SFMTA publishes no night or rush surcharge, so the fare must not move.
    const night = computeFare(t, route, { pickup: SF_UNION_SQ, destination: SFO, at: NIGHT });
    expect(night.minMinor).toBe(toAirport.minMinor);
  });
});

describe('fare invariants', () => {
  it('never returns a max below its min', () => {
    for (const t of allTariffs()) {
      for (const seconds of [60, 600, 3600]) {
        const fare = computeFare(
          t,
          { distanceMeters: 5 * MI, durationSeconds: seconds },
          { pickup: PRINCE_ST, destination: UPPER_WEST, at: OFF_PEAK },
        );
        expect(fare.maxMinor).toBeGreaterThanOrEqual(fare.minMinor);
      }
    }
  });

  it('components always sum to the minimum fare, ignoring the uncertain band', () => {
    const fare = computeFare(
      nyc(),
      { distanceMeters: 6 * MI, durationSeconds: 2400 },
      { pickup: PRINCE_ST, destination: UPPER_WEST, at: RUSH },
    );
    const certain = fare.components
      .filter((c) => !c.uncertain)
      .reduce((sum, c) => sum + c.amountMinor, 0);
    expect(certain).toBe(fare.minMinor);
    const all = fare.components.reduce((sum, c) => sum + c.amountMinor, 0);
    expect(all).toBe(fare.maxMinor);
  });

  it('always says tolls and tip are excluded', () => {
    const fare = computeFare(
      nyc(),
      { distanceMeters: 6 * MI, durationSeconds: 900 },
      { pickup: PRINCE_ST, destination: JFK, at: OFF_PEAK },
    );
    expect(fare.explanation.join(' ')).toMatch(/[Tt]olls and gratuity are not included/);
  });

  it('produces an integer number of cents', () => {
    const fare = computeFare(
      nyc(),
      { distanceMeters: 7.77 * MI, durationSeconds: 1234 },
      { pickup: PRINCE_ST, destination: UPPER_WEST, at: RUSH },
    );
    expect(Number.isInteger(fare.minMinor)).toBe(true);
    expect(Number.isInteger(fare.maxMinor)).toBe(true);
  });

  it('handles a zero-distance route without producing a negative charge', () => {
    const fare = computeFare(
      nyc(),
      { distanceMeters: 0, durationSeconds: 0 },
      { pickup: PRINCE_ST, destination: PRINCE_ST, at: OFF_PEAK },
    );
    expect(fare.minMinor).toBeGreaterThan(0);
  });
});

describe('time windows', () => {
  const t = (hour: number, minute = 0, weekday = 2): LocalTime => ({
    hour,
    minute,
    weekday,
    year: 2026,
    month: 9,
    day: 8,
  });

  it('handles a window that wraps midnight', () => {
    expect(inWindow(t(21), hm(20), hm(6))).toBe(true);
    expect(inWindow(t(3), hm(20), hm(6))).toBe(true);
    expect(inWindow(t(6), hm(20), hm(6))).toBe(false);
    expect(inWindow(t(19, 59), hm(20), hm(6))).toBe(false);
  });

  it('is inclusive of the start and exclusive of the end', () => {
    expect(inWindow(t(16), hm(16), hm(20))).toBe(true);
    expect(inWindow(t(20), hm(16), hm(20))).toBe(false);
  });

  it('respects half-hour boundaries', () => {
    expect(inWindow(t(15, 29), hm(15, 30), hm(19))).toBe(false);
    expect(inWindow(t(15, 30), hm(15, 30), hm(19))).toBe(true);
  });

  it('reads local time in the market timezone, not the server timezone', () => {
    // 21:00 UTC is 17:00 in New York and 14:00 in Los Angeles.
    const at = new Date('2026-09-08T21:00:00Z');
    expect(localTimeIn('America/New_York', at).hour).toBe(17);
    expect(localTimeIn('America/Los_Angeles', at).hour).toBe(14);
  });
});

describe('zone geometry', () => {
  it('places Manhattan points inside the island polygon and others outside', () => {
    const manhattan = nyc().zones.find((z) => z.id === 'manhattan');
    if (!manhattan || manhattan.shape.kind !== 'polygon') throw new Error('missing');
    const ring = manhattan.shape.ring;
    expect(inPolygon(PRINCE_ST, ring)).toBe(true);
    expect(inPolygon(UPPER_WEST, ring)).toBe(true);
    expect(inPolygon(BROOKLYN, ring)).toBe(false);
    expect(inPolygon(JFK, ring)).toBe(false);
  });

  it('separates below-96th from above-96th', () => {
    const zone = nyc().zones.find((z) => z.id === 'manhattan_below_96');
    if (!zone || zone.shape.kind !== 'polygon') throw new Error('missing');
    expect(inPolygon(PRINCE_ST, zone.shape.ring)).toBe(true);
    expect(inPolygon(HARLEM, zone.shape.ring)).toBe(false);
  });
});

describe('meter boundary arithmetic', () => {
  it('does not charge an extra unit at an exact boundary', () => {
    // Routing reports whole metres. A trip that is exactly N units long
    // therefore arrives as N units plus a fraction of a metre, and a naive
    // ceil() charged a whole extra unit on roughly half of all boundaries.
    for (const t of allTariffs()) {
      for (let n = 1; n <= 120; n += 1) {
        const exactMiles = t.initialDistanceMiles + n * t.unitDistanceMiles;
        const meters = Math.round(exactMiles * MI);
        const billable = Math.max(0, meters - t.initialDistanceMiles * MI);
        expect(meterUnits(billable, t.unitDistanceMiles)).toBe(n);
      }
    }
  });

  it('still ticks the next unit once the boundary is genuinely crossed', () => {
    for (const t of allTariffs()) {
      for (let n = 1; n <= 60; n += 1) {
        const meters = Math.round((t.initialDistanceMiles + n * t.unitDistanceMiles) * MI) + 25;
        const billable = Math.max(0, meters - t.initialDistanceMiles * MI);
        expect(meterUnits(billable, t.unitDistanceMiles)).toBe(n + 1);
      }
    }
  });

  it('charges nothing beyond the initial distance for a trip inside it', () => {
    expect(meterUnits(0, 0.2)).toBe(0);
    expect(meterUnits(-50, 0.2)).toBe(0);
  });

  it('charges one unit for any real distance past the initial allowance', () => {
    expect(meterUnits(50, 0.2)).toBe(1);
  });
});
