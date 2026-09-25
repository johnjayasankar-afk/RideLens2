/**
 * The railroad fare tables, and the rules that pick a number out of them.
 *
 * Three separate risks are covered. Transcription: a fare read off an
 * operator's page is only as good as the reading, so every station is checked
 * against the feed it came from and published fares are pinned to the cent.
 * The peak rule, which moves real money — Metro-North zone 4 is $10.25 off-peak
 * and $13.75 peak, and getting the direction backwards would overcharge every
 * evening commuter. And the two table shapes not bleeding into each other:
 * Metra has no peak fare at all, and inventing one would be a fabrication.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARDING_HORIZON_SECONDS,
  isPeakTrain,
  MIN_RAIL_METERS,
  MIN_TIMETABLE_CALLS,
  planRailTrip,
  priceRailTrip,
  STATION_ACCESS_METERS,
  type RailSystem,
  type RailTrip,
  type TerminalZoneFares,
} from '@/domain/rail';
import { METRA, METRO_NORTH, RAIL_SYSTEMS, systemsNear } from '@/sources/rail/systems';

const station = (system: RailSystem, name: string) => {
  const found = system.stations.find((s) => s.name === name);
  if (!found) throw new Error(`no station named ${name} on ${system.name}`);
  return found;
};

/** Local time, written the way a timetable reads. September is EDT. */
const nyc = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);
const FRIDAY = '2026-09-04';
const SATURDAY = '2026-09-05';
const LABOR_DAY = '2026-09-07';

const MNR_FARES = METRO_NORTH.fares as TerminalZoneFares;

describe('every published table, whatever its shape', () => {
  it.each(RAIL_SYSTEMS.map((s) => [s.name, s] as const))(
    '%s holds no duplicate station ids',
    (_name, system) => {
      const ids = system.stations.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(RAIL_SYSTEMS.map((s) => [s.name, s] as const))(
    '%s gives every station at least one line',
    (_name, system) => {
      for (const s of system.stations) {
        expect(s.routes.length, `${s.name} has lines`).toBeGreaterThan(0);
      }
    },
  );

  it.each(RAIL_SYSTEMS.map((s) => [s.name, s] as const))(
    '%s says when its fares were last checked',
    (_name, system) => {
      expect(system.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(system.fareSourceUrl).toMatch(/^https:\/\//);
      expect(system.scheduleSourceUrl).toMatch(/^https:\/\//);
    },
  );
});

describe('the Metro-North fare table', () => {
  it('gives every station a zone that exists', () => {
    for (const s of METRO_NORTH.stations) {
      expect(MNR_FARES.zones[s.zone], `${s.name} is in zone ${s.zone}`).toBeDefined();
    }
  });

  it('gives every zone at least one station', () => {
    for (const id of Object.keys(MNR_FARES.zones)) {
      const inZone = METRO_NORTH.stations.filter((s) => s.zone === Number(id));
      expect(inZone.length, `zone ${id} has stations`).toBeGreaterThan(0);
    }
  });

  it('never prices off-peak above peak, or pre-boarding above onboard', () => {
    for (const [id, z] of Object.entries(MNR_FARES.zones)) {
      expect(z.offPeakMinor, `zone ${id} off-peak <= peak`).toBeLessThanOrEqual(z.peakMinor);
      expect(z.onboardPeakMinor, `zone ${id} onboard peak is dearer`).toBeGreaterThan(z.peakMinor);
      expect(z.onboardOffPeakMinor, `zone ${id} onboard off-peak is dearer`).toBeGreaterThan(
        z.offPeakMinor,
      );
    }
  });

  it('places every station inside the region the railroad runs in', () => {
    for (const s of METRO_NORTH.stations) {
      expect(s.lat, s.name).toBeGreaterThan(40.5);
      expect(s.lat, s.name).toBeLessThan(42.0);
      expect(s.lng, s.name).toBeGreaterThan(-74.1);
      expect(s.lng, s.name).toBeLessThan(-72.8);
    }
  });

  /*
   * Pinned to the cent against the MTA's own tables. If a fare changes these
   * fail, which is the point: the number in the repo is a transcription with a
   * date on it, and a silent drift is exactly what must not happen.
   */
  it.each([
    ['Scarsdale', 4, 1375, 1025],
    ['White Plains', 4, 1375, 1025],
    ['Grand Central', 1, 725, 525],
    ['Yonkers', 3, 1250, 925],
    ['Stamford', 16, 1775, 1325],
    ['New Haven', 21, 2725, 2025],
    ['Poughkeepsie', 9, 2825, 2100],
    ['Wassaic', 10, 2975, 2200],
  ])('prices %s as zone %i at $%i/$%i', (name, zone, peak, offPeak) => {
    const s = station(METRO_NORTH, String(name));
    expect(s.zone).toBe(zone);
    expect(MNR_FARES.zones[s.zone]?.peakMinor).toBe(peak);
    expect(MNR_FARES.zones[s.zone]?.offPeakMinor).toBe(offPeak);
  });

  it('declines to state a run time where the operator runs no direct train', () => {
    // The Waterbury branch changes at Bridgeport; there is no through service
    // to invent a duration from.
    expect(station(METRO_NORTH, 'Waterbury').medianRunSeconds).toBeNull();
    expect(station(METRO_NORTH, 'Naugatuck').medianRunSeconds).toBeNull();
    expect(station(METRO_NORTH, 'Scarsdale').medianRunSeconds).toBeGreaterThan(0);
  });
});

describe('the Metra fare table', () => {
  const pairs = METRA.fares.kind === 'ZONE_PAIR' ? METRA.fares.pairs : [];

  it('prices every pair of zones its stations sit in', () => {
    const zones = [...new Set(METRA.stations.map((s) => s.zone))].sort();
    for (const a of zones) {
      for (const b of zones) {
        const found = pairs.some(
          (p) =>
            (p.between[0] === a && p.between[1] === b) ||
            (p.between[0] === b && p.between[1] === a),
        );
        expect(found, `zone ${a} to zone ${b}`).toBe(true);
      }
    }
  });

  /*
   * The fare ladder only climbs on trips into downtown. 2 to 4 is two zones
   * apart and still the base fare, which is why the pairs are enumerated
   * rather than derived from a zone difference — a difference-based rule would
   * have charged $5.50 for a trip Metra prices at $3.75.
   */
  it.each([
    [1, 1, 375],
    [1, 2, 375],
    [1, 3, 550],
    [1, 4, 675],
    [2, 4, 375],
    [3, 4, 375],
  ])('charges zone %i to zone %i at %i cents', (a, b, minor) => {
    const found = pairs.find(
      (p) =>
        (p.between[0] === a && p.between[1] === b) || (p.between[0] === b && p.between[1] === a),
    );
    expect(found?.fareMinor).toBe(minor);
  });

  it('places every station in the Chicago region', () => {
    for (const s of METRA.stations) {
      expect(s.lat, s.name).toBeGreaterThan(41.0);
      expect(s.lat, s.name).toBeLessThan(43.0);
      expect(s.lng, s.name).toBeGreaterThan(-89.0);
      expect(s.lng, s.name).toBeLessThan(-87.0);
    }
  });
});

describe('peak is a property of the train, not of the ticket counter', () => {
  const run = station(METRO_NORTH, 'Scarsdale').medianRunSeconds;
  const base = { fares: MNR_FARES, timeZone: METRO_NORTH.timeZone, runSeconds: run };

  it('charges peak on a weekday train arriving in the morning window', () => {
    const boardAt = new Date(nyc(FRIDAY, '08:00').getTime() - (run ?? 0) * 1000);
    expect(isPeakTrain({ ...base, direction: 'INBOUND', boardAt })).toBe(true);
  });

  it('charges off-peak on a weekday train arriving after ten', () => {
    const boardAt = new Date(nyc(FRIDAY, '11:30').getTime() - (run ?? 0) * 1000);
    expect(isPeakTrain({ ...base, direction: 'INBOUND', boardAt })).toBe(false);
  });

  it('charges peak leaving town in the evening', () => {
    expect(isPeakTrain({ ...base, direction: 'OUTBOUND', boardAt: nyc(FRIDAY, '17:10') })).toBe(
      true,
    );
  });

  it('charges peak leaving town in the reverse-peak morning window', () => {
    // Metro-North's own rule: weekday trains leaving Grand Central 6am-9am.
    expect(isPeakTrain({ ...base, direction: 'OUTBOUND', boardAt: nyc(FRIDAY, '07:30') })).toBe(
      true,
    );
  });

  it('charges off-peak leaving town mid-morning', () => {
    expect(isPeakTrain({ ...base, direction: 'OUTBOUND', boardAt: nyc(FRIDAY, '10:30') })).toBe(
      false,
    );
  });

  it('charges off-peak all day at the weekend', () => {
    const boardAt = new Date(nyc(SATURDAY, '08:00').getTime() - (run ?? 0) * 1000);
    expect(isPeakTrain({ ...base, direction: 'INBOUND', boardAt })).toBe(false);
    expect(isPeakTrain({ ...base, direction: 'OUTBOUND', boardAt: nyc(SATURDAY, '17:10') })).toBe(
      false,
    );
  });

  it('charges off-peak on a public holiday', () => {
    expect(isPeakTrain({ ...base, direction: 'OUTBOUND', boardAt: nyc(LABOR_DAY, '17:10') })).toBe(
      false,
    );
  });

  it('cannot answer inbound without a scheduled run time', () => {
    expect(
      isPeakTrain({
        ...base,
        direction: 'INBOUND',
        boardAt: nyc(FRIDAY, '08:00'),
        runSeconds: null,
      }),
    ).toBeNull();
  });
});

function mnrTripTo(name: string): RailTrip {
  const outer = station(METRO_NORTH, name);
  const zone = MNR_FARES.zones[outer.zone];
  if (!zone) throw new Error('no zone');
  return {
    origin: { station: outer, meters: 500 },
    destination: { station: station(METRO_NORTH, 'Grand Central'), meters: 2000 },
    runSeconds: outer.medianRunSeconds,
    fare: { kind: 'TO_TERMINAL', zoneId: outer.zone, zone, direction: 'INBOUND', station: outer },
  };
}

describe('what the rider is charged', () => {
  it('gives one exact fare when the whole boarding window is off-peak', () => {
    const fare = priceRailTrip({
      system: METRO_NORTH,
      trip: mnrTripTo('Scarsdale'),
      at: nyc(SATURDAY, '13:00'),
      passengers: 1,
    });
    expect(fare.exact).toBe(true);
    expect(fare.peak).toBe(false);
    expect(fare.minMinor).toBe(1025);
    expect(fare.maxMinor).toBe(1025);
  });

  it('multiplies by the party, because every rider buys a ticket', () => {
    const fare = priceRailTrip({
      system: METRO_NORTH,
      trip: mnrTripTo('Scarsdale'),
      at: nyc(SATURDAY, '13:00'),
      passengers: 4,
    });
    expect(fare.minMinor).toBe(1025 * 4);
    expect(fare.onboardMinor).toBe(1800 * 4);
  });

  it('never quotes a number between the two published fares at a boundary', () => {
    const trip = mnrTripTo('Scarsdale');
    const run = trip.runSeconds ?? 0;
    // Board just early enough that "now" arrives before 10:00 and the far end
    // of the boarding horizon arrives after it.
    const at = new Date(nyc(FRIDAY, '09:59').getTime() - run * 1000);
    const soonArrives = new Date(at.getTime() + (BOARDING_HORIZON_SECONDS + run) * 1000);
    expect(soonArrives.getTime()).toBeGreaterThan(nyc(FRIDAY, '10:00').getTime());

    const fare = priceRailTrip({ system: METRO_NORTH, trip, at, passengers: 1 });
    expect(fare.exact).toBe(false);
    expect(fare.peak).toBeNull();
    expect(fare.minMinor).toBe(1025);
    expect(fare.maxMinor).toBe(1375);
  });

  it('prices a whole zone identically, because zones are not distances', () => {
    const at = nyc(SATURDAY, '13:00');
    const a = priceRailTrip({
      system: METRO_NORTH,
      trip: mnrTripTo('Scarsdale'),
      at,
      passengers: 1,
    });
    const b = priceRailTrip({
      system: METRO_NORTH,
      trip: mnrTripTo('White Plains'),
      at,
      passengers: 1,
    });
    expect(b.minMinor).toBe(a.minMinor);
  });
});

describe('which trips the railroad will price at all', () => {
  const SCARSDALE_HOUSE = { lat: 41.0176, lng: -73.8035 };
  const CHELSEA = { lat: 40.7449, lng: -74.0079 };
  const MIDTOWN = { lat: 40.7549, lng: -73.984 };
  const JFK = { lat: 40.6413, lng: -73.7781 };
  const STAMFORD = { lat: 41.0534, lng: -73.5387 };
  const WHITE_PLAINS = { lat: 41.034, lng: -73.7629 };
  const SAN_FRANCISCO = { lat: 37.7749, lng: -122.4194 };

  it('prices the suburb-to-city trip no city taxi meter covers', () => {
    const plan = planRailTrip({
      pickup: SCARSDALE_HOUSE,
      destination: CHELSEA,
      system: METRO_NORTH,
    });
    expect('reason' in plan).toBe(false);
    if ('reason' in plan) return;
    expect(plan.fare.kind).toBe('TO_TERMINAL');
    if (plan.fare.kind !== 'TO_TERMINAL') return;
    expect(plan.fare.direction).toBe('INBOUND');
    expect(plan.fare.zoneId).toBe(4);
    expect(plan.destination.station.name).toBe('Grand Central');
    expect(plan.origin.meters).toBeLessThan(STATION_ACCESS_METERS);
  });

  it('prices the same trip in reverse', () => {
    const plan = planRailTrip({
      pickup: CHELSEA,
      destination: SCARSDALE_HOUSE,
      system: METRO_NORTH,
    });
    expect('reason' in plan).toBe(false);
    if ('reason' in plan || plan.fare.kind !== 'TO_TERMINAL') return;
    expect(plan.fare.direction).toBe('OUTBOUND');
    expect(plan.fare.zoneId).toBe(4);
  });

  it('refuses a short hop across town before it looks at a timetable', () => {
    const plan = planRailTrip({ pickup: CHELSEA, destination: MIDTOWN, system: METRO_NORTH });
    expect('reason' in plan && plan.reason).toMatch(/too short for a railroad journey/i);
  });

  it('refuses a long trip with both ends in town', () => {
    // Financial District to Harlem: seven miles, and both ends reach a
    // terminal, so there is no zone fare to read.
    const plan = planRailTrip({
      pickup: { lat: 40.7075, lng: -74.0113 },
      destination: { lat: 40.8079, lng: -73.9451 },
      system: METRO_NORTH,
    });
    expect('reason' in plan && plan.reason).toMatch(/both ends/i);
  });

  it('refuses a station-to-station trip, whose fare it has never read', () => {
    const plan = planRailTrip({ pickup: WHITE_PLAINS, destination: STAMFORD, system: METRO_NORTH });
    expect('reason' in plan && plan.reason).toMatch(/Grand Central/);
  });

  it('refuses an airport the railroad does not reach, and says how far off it is', () => {
    const plan = planRailTrip({ pickup: CHELSEA, destination: JFK, system: METRO_NORTH });
    expect('reason' in plan && plan.reason).toMatch(/within reach of the destination/i);
    expect('reason' in plan && plan.reason).toMatch(/mi away/);
  });

  it('does not even consider a railroad three thousand miles away', () => {
    expect(systemsNear(SAN_FRANCISCO, { lat: 37.6213, lng: -122.379 })).toEqual([]);
    expect(systemsNear(SCARSDALE_HOUSE, CHELSEA)).toEqual([METRO_NORTH]);
  });
});

describe('a zone-pair table prices station to station', () => {
  const EVANSTON = { lat: 42.0451, lng: -87.6877 };
  const LOOP = { lat: 41.8827, lng: -87.6233 };
  const NAPERVILLE = { lat: 41.7797, lng: -88.1455 };
  const RIVER_NORTH = { lat: 41.8925, lng: -87.6341 };
  const GLENCOE = { lat: 42.1355, lng: -87.758 };

  it('prices the Chicago suburb whose taxi card correctly refuses it', () => {
    const plan = planRailTrip({ pickup: EVANSTON, destination: LOOP, system: METRA });
    expect('reason' in plan).toBe(false);
    if ('reason' in plan || plan.fare.kind !== 'ZONE_PAIR') return;
    expect(plan.fare.fareMinor).toBe(375);
    expect(plan.fare.lineName).toBe('Union Pacific North');
    expect(plan.origin.station.name).toBe('Evanston (Davis St.)');
  });

  it('climbs the ladder for the outer zones', () => {
    const plan = planRailTrip({ pickup: NAPERVILLE, destination: LOOP, system: METRA });
    if ('reason' in plan || plan.fare.kind !== 'ZONE_PAIR') throw new Error('expected a fare');
    expect(plan.fare.fareMinor).toBe(675);
    expect(plan.runSeconds).toBeGreaterThan(0);
  });

  it('charges the same fare all day, with no peak to straddle', () => {
    const plan = planRailTrip({ pickup: EVANSTON, destination: LOOP, system: METRA });
    if ('reason' in plan) throw new Error('expected a fare');
    for (const hhmm of ['08:00', '13:00', '17:30']) {
      const fare = priceRailTrip({
        system: METRA,
        trip: plan,
        at: new Date(`${FRIDAY}T${hhmm}:00-05:00`),
        passengers: 1,
      });
      expect(fare.exact).toBe(true);
      expect(fare.peak).toBeNull();
      expect(fare.minMinor).toBe(375);
      expect(fare.maxMinor).toBe(375);
      // Metra publishes no separate onboard price, so none is claimed.
      expect(fare.onboardMinor).toBeNull();
    }
  });

  it('states no duration for a suburb-to-suburb trip it has not timed', () => {
    const plan = planRailTrip({ pickup: EVANSTON, destination: GLENCOE, system: METRA });
    if ('reason' in plan) throw new Error('expected a fare');
    expect(plan.runSeconds).toBeNull();
    if (plan.fare.kind !== 'ZONE_PAIR') return;
    // Zone 2 to zone 3, nowhere near downtown: still the base fare.
    expect(plan.fare.fareMinor).toBe(375);
  });

  it('refuses a walk across the Loop, which six terminals are all within reach of', () => {
    const plan = planRailTrip({ pickup: LOOP, destination: RIVER_NORTH, system: METRA });
    expect('reason' in plan && plan.reason).toMatch(/too short for a railroad journey/i);
  });

  it('picks the terminal the rider\u2019s own line actually reaches', () => {
    // The station nearest a Loop address is Millennium, on the Metra Electric.
    // The train from Evanston is a Union Pacific North train into Ogilvie.
    // Matching each end to its nearest station independently answers "no line
    // connects these", which is true of that pair and false of the trip.
    const plan = planRailTrip({ pickup: EVANSTON, destination: LOOP, system: METRA });
    if ('reason' in plan) throw new Error(plan.reason);
    expect(plan.destination.station.name).toBe('Chicago OTC');
  });

  it('refuses stations no single line connects', () => {
    // Naperville is on the BNSF; Glencoe is on the UP North. Both are real
    // Metra stations, and no one train calls at both.
    const plan = planRailTrip({ pickup: NAPERVILLE, destination: GLENCOE, system: METRA });
    expect('reason' in plan && plan.reason).toMatch(/No single Metra line/);
  });

  it('holds the shortest sensible rail trip above walking distance', () => {
    expect(MIN_RAIL_METERS).toBeGreaterThan(1_000);
  });

  /*
   * O'Hare has a Metra station — O'Hare Transfer, on the peak-only North
   * Central Service, twelve entries in the whole timetable and a shuttle ride
   * from the terminals. Quoting $3.75 from the Loop at two in the afternoon
   * would be a real published fare for a train that is not running, so the
   * trip either falls to a station that runs all day or is refused outright.
   */
  it('never routes through a station the timetable barely serves', () => {
    const OHARE = { lat: 41.9786, lng: -87.9048 };
    const plan = planRailTrip({ pickup: LOOP, destination: OHARE, system: METRA });
    if ('reason' in plan) return;
    expect(plan.destination.station.name).not.toBe("O'Hare Transfer");
    expect(plan.destination.station.timetableCalls).toBeGreaterThanOrEqual(MIN_TIMETABLE_CALLS);
  });

  it('says so when the only station in reach is a peak-only stop', () => {
    // Lemont is on the Heritage Corridor: three trains each way, weekday
    // peak only, and nothing else within reach of it.
    const plan = planRailTrip({
      pickup: LOOP,
      destination: { lat: 41.6736, lng: -88.0025 },
      system: METRA,
    });
    expect('reason' in plan && plan.reason).toMatch(/handful of times a day/i);
    expect('reason' in plan && plan.reason).toMatch(/Lemont/);
  });
});

describe('a fare is only an option if a train comes', () => {
  it('holds the threshold below every normal commuter station', () => {
    for (const system of RAIL_SYSTEMS) {
      const served = system.stations.filter((s) => s.timetableCalls >= MIN_TIMETABLE_CALLS);
      // The great majority of stations on both railroads run to a frequency
      // anybody can turn up and use. What falls out is the peak-only branches:
      // Metra's Heritage Corridor and North Central Service, and Metro-North's
      // seasonal flag stops.
      expect(served.length / system.stations.length, system.name).toBeGreaterThan(0.85);
    }
  });

  it.each([
    ['Breakneck Ridge', METRO_NORTH],
    ['Appalachian Trail', METRO_NORTH],
  ] as const)('keeps the seasonal flag stop %s out of a quote', (name, system) => {
    expect(station(system, name).timetableCalls).toBeLessThan(MIN_TIMETABLE_CALLS);
  });

  it.each([
    ['Scarsdale', METRO_NORTH],
    ['Stamford', METRO_NORTH],
    ['Evanston (Davis St.)', METRA],
    ['Naperville', METRA],
  ] as const)('keeps %s, which runs all day', (name, system) => {
    expect(station(system, name).timetableCalls).toBeGreaterThanOrEqual(MIN_TIMETABLE_CALLS);
  });
});
