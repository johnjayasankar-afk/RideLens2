/**
 * Published municipal taxi rate cards.
 *
 * Every figure here is transcribed from the regulator's own published
 * schedule, and every market carries `authority`, `sourceUrl` and
 * `verifiedOn` so a wrong number is traceable to a source rather than to
 * someone's memory. Re-verify on the schedule in docs/DATA_SOURCE_MATRIX.md;
 * cities change these by rulemaking, without notice to anyone downstream.
 *
 * Amounts are in integer minor units (cents), never decimals.
 *
 * NOT included here, deliberately: any modelled Uber/Lyft/Empower rate card.
 * Those fares are market-set and change minute to minute; a "rate card" for
 * them would be an invention, which is precisely what this product refuses to
 * put on screen.
 */
import type { Tariff, Zone } from '@/domain/tariff';
import { hm, inBBox, inPolygon, type BBox, type Point, type Ring } from '@/domain/geo';

// ── Shared airport zones ───────────────────────────────────────────────────
const airport = (
  id: string,
  label: string,
  lat: number,
  lng: number,
  radiusMeters: number,
): Zone => ({
  id,
  label,
  shape: { kind: 'circle', circle: { center: { lat, lng }, radiusMeters } },
});

/**
 * Manhattan south of 96th Street, which is where New York's congestion
 * surcharge applies. Traced coarsely around the island; a few metres of error
 * at the shoreline cannot change the answer because the water is not a pickup.
 */
const MANHATTAN_BELOW_96: Zone = {
  id: 'manhattan_below_96',
  label: 'Manhattan below 96th St',
  shape: {
    kind: 'polygon',
    ring: [
      [-74.0206, 40.7014],
      [-74.0176, 40.7096],
      [-74.0113, 40.7264],
      [-74.0097, 40.7368],
      [-74.0089, 40.7497],
      [-73.9995, 40.7628],
      [-73.9714, 40.7935],
      [-73.9469, 40.7847],
      [-73.9418, 40.7796],
      [-73.9714, 40.7414],
      [-73.9721, 40.7098],
      [-73.9971, 40.7047],
      [-74.0206, 40.7014],
    ],
  },
};

/** Manhattan south of and including 60th St — the MTA congestion-pricing zone. */
const MANHATTAN_BELOW_60: Zone = {
  id: 'manhattan_below_60',
  label: 'Manhattan below 60th St',
  shape: {
    kind: 'polygon',
    ring: [
      [-74.0206, 40.7014],
      [-74.0176, 40.7096],
      [-74.0113, 40.7264],
      [-74.0097, 40.7368],
      [-74.0086, 40.7546],
      [-73.9583, 40.7648],
      [-73.9553, 40.7519],
      [-73.9721, 40.7098],
      [-73.9971, 40.7047],
      [-74.0206, 40.7014],
    ],
  },
};

/** All of Manhattan, used for the JFK flat fare. */
const MANHATTAN: Zone = {
  id: 'manhattan',
  label: 'Manhattan',
  shape: {
    kind: 'polygon',
    ring: [
      [-74.0206, 40.7014],
      [-74.0113, 40.7264],
      [-74.0089, 40.7497],
      [-73.9995, 40.7628],
      [-73.933, 40.855],
      [-73.9068, 40.873],
      [-73.9106, 40.8779],
      [-73.9235, 40.873],
      [-73.934, 40.834],
      [-73.9418, 40.7796],
      [-73.9714, 40.7414],
      [-73.9721, 40.7098],
      [-73.9971, 40.7047],
      [-74.0206, 40.7014],
    ],
  },
};

// ── New York City ──────────────────────────────────────────────────────────
/**
 * Source: NYC Taxi & Limousine Commission passenger fare schedule.
 * The JFK flat fare is the headline case: $70 is the rule, not an estimate.
 */
const NYC: Tariff = {
  marketId: 'nyc',
  marketName: 'New York City',
  timeZone: 'America/New_York',
  currency: 'USD',
  authority: 'the NYC Taxi & Limousine Commission',
  sourceUrl: 'https://www.nyc.gov/site/tlc/passengers/taxi-fare.page',
  verifiedOn: '2026-09-04',

  initialChargeMinor: 300,
  initialDistanceMiles: 0.2,
  perUnitMinor: 70,
  unitDistanceMiles: 0.2,
  // The same 70c unit is charged per 60 seconds in slow traffic.
  perSlowUnitMinor: 70,
  slowUnitSeconds: 60,
  slowSpeedMph: 12,

  zones: [
    MANHATTAN,
    MANHATTAN_BELOW_96,
    MANHATTAN_BELOW_60,
    airport('jfk', 'JFK Airport', 40.6413, -73.7781, 3000),
    airport('lga', 'LaGuardia Airport', 40.7769, -73.874, 2000),
    airport('ewr', 'Newark Airport', 40.6895, -74.1745, 3000),
  ],

  flatFares: [
    {
      id: 'jfk_manhattan',
      label: 'JFK ↔ Manhattan flat fare',
      betweenZones: ['jfk', 'manhattan'],
      amountMinor: 7000,
    },
  ],

  surcharges: [
    { id: 'improvement', label: 'Taxicab improvement surcharge', amountMinor: 100 },
    { id: 'mta', label: 'MTA State surcharge', amountMinor: 50 },
    {
      id: 'congestion',
      label: 'Congestion surcharge (below 96th St)',
      amountMinor: 250,
      when: { touchesZone: 'manhattan_below_96' },
    },
    {
      id: 'mta_congestion_toll',
      label: 'MTA congestion pricing toll (below 60th St)',
      amountMinor: 75,
      when: { touchesZone: 'manhattan_below_60' },
    },
    {
      id: 'rush_metered',
      label: 'Rush hour surcharge (weekdays 4–8pm)',
      amountMinor: 250,
      when: {
        window: { startMin: hm(16), endMin: hm(20) },
        weekdaysOnly: true,
        notOnHoliday: true,
        meteredOnly: true,
      },
    },
    {
      id: 'rush_flat',
      label: 'Airport flat-fare rush hour surcharge (weekdays 4–8pm)',
      amountMinor: 500,
      when: {
        window: { startMin: hm(16), endMin: hm(20) },
        weekdaysOnly: true,
        notOnHoliday: true,
        flatOnly: true,
      },
    },
    {
      id: 'night',
      label: 'Overnight surcharge (8pm–6am)',
      amountMinor: 100,
      when: { window: { startMin: hm(20), endMin: hm(6) }, meteredOnly: true },
    },
    {
      id: 'lga',
      label: 'LaGuardia Airport surcharge',
      amountMinor: 500,
      when: { touchesZone: 'lga' },
    },
    {
      id: 'ewr',
      label: 'Newark Airport surcharge',
      amountMinor: 2000,
      // "$20.00 surcharge applies to all trips TO Newark Airport." A yellow cab
      // cannot pick up there at all, so charging it in the other direction was
      // both wrong and impossible.
      when: { dropoffInZone: 'ewr' },
    },
  ],
};

// ── Chicago ────────────────────────────────────────────────────────────────
/** Source: City of Chicago Business Affairs & Consumer Protection taxi rates. */
const CHICAGO: Tariff = {
  marketId: 'chicago',
  marketName: 'Chicago',
  timeZone: 'America/Chicago',
  currency: 'USD',
  authority: 'the City of Chicago (BACP)',
  sourceUrl:
    'https://www.chicago.gov/content/dam/city/depts/bacp/publicvehicleinfo/publicvehicleindustrynotices/2026/chicagotaxifareratestructureeffectivejuly12026.pdf',
  verifiedOn: '2026-09-04',

  // Rate structure effective 1 July 2026 — the first increase in a decade.
  // Pre-July figures (25c per 1/9 mile, 20c per 36s) are now wrong.
  initialChargeMinor: 325,
  initialDistanceMiles: 1 / 9,
  perUnitMinor: 31,
  unitDistanceMiles: 1 / 9,
  perSlowUnitMinor: 31,
  slowUnitSeconds: 45,
  slowSpeedMph: 12,

  zones: [
    airport('ord', "O'Hare Airport", 41.9742, -87.9073, 3500),
    airport('mdw', 'Midway Airport', 41.7868, -87.7522, 2000),
  ],
  flatFares: [],
  surcharges: [
    // "ILLINOIS AIRPORT DEPARTURE TAX (applies to taxi fares leaving the
    // airports)" — leaving, so a trip *to* O'Hare does not pay it.
    {
      id: 'airport_departure',
      label: 'Illinois airport departure tax',
      amountMinor: 400,
      when: { pickupInZone: 'ord' },
    },
    {
      id: 'midway_departure',
      label: 'Illinois airport departure tax',
      amountMinor: 400,
      when: { pickupInZone: 'mdw' },
    },
    {
      id: 'rush',
      label: 'Rush hour surcharge (3:30–7pm)',
      amountMinor: 250,
      // 3:30pm, not 4pm — rounding to the hour would undercharge a half-hour
      // window every weekday.
      when: { window: { startMin: hm(15, 30), endMin: hm(19) } },
    },
    {
      id: 'night',
      label: 'Overnight surcharge (8pm–6am)',
      amountMinor: 100,
      when: { window: { startMin: hm(20), endMin: hm(6) } },
    },
  ],
  // "FIRST ADDITIONAL PASSENGER (aged 12-64) $1.00 / EACH ADDITIONAL
  // PASSENGERS (aged 12-64) $0.50".
  passengerCharges: { firstExtraMinor: 100, eachAdditionalMinor: 50 },
};

// ── Washington, DC ─────────────────────────────────────────────────────────
/** Source: DC Department of For-Hire Vehicles taxicab fare schedule. */
const DC: Tariff = {
  marketId: 'dc',
  marketName: 'Washington, DC',
  timeZone: 'America/New_York',
  currency: 'USD',
  authority: 'the DC Department of For-Hire Vehicles',
  sourceUrl: 'https://dfhv.dc.gov/page/taxicab-fares',
  verifiedOn: '2026-09-04',

  initialChargeMinor: 400,
  initialDistanceMiles: 0.125,
  // Published as "$2.56 each additional mile". The first unit is 1/8 mile and
  // $2.56 divides into eighths exactly, so the meter ticks 32c per 1/8 mile —
  // charging in whole miles instead would overstate a short trip by up to $2.
  perUnitMinor: 32,
  unitDistanceMiles: 0.125,
  // Published as a $25/hour wait rate, billed in 60-second increments.
  perSlowUnitMinor: 42,
  slowUnitSeconds: 60,
  slowSpeedMph: 10,

  /*
   * No airport zones. Reagan National and Dulles are both in Virginia, and a
   * cab picking up there is Virginia-regulated, not DC-regulated — the DC card
   * has no rule that mentions either, and the zones that used to sit here were
   * referenced by nothing. Declaring them only widened the market box until it
   * swallowed pickups the District does not govern.
   */
  zones: [],
  flatFares: [],
  surcharges: [
    { id: 'passenger', label: 'Passenger surcharge', amountMinor: 50 },
    // The $1.00 emergency fuel surcharge is NOT here on purpose. It is a
    // contingent charge that only applies while the District has declared a
    // fuel emergency, and adding it unconditionally put a dollar on every DC
    // fare that no passenger was actually being charged.
  ],
  // "Additional passenger (per person): $1.00".
  passengerCharges: { firstExtraMinor: 100, eachAdditionalMinor: 100 },
};

// ── San Francisco ──────────────────────────────────────────────────────────
/** Source: SFMTA taxi fares. */
const SF: Tariff = {
  marketId: 'sf',
  marketName: 'San Francisco',
  timeZone: 'America/Los_Angeles',
  currency: 'USD',
  authority: 'the SFMTA',
  sourceUrl: 'https://www.sfmta.com/getting-around/taxi/taxi-fares',
  verifiedOn: '2026-09-04',

  initialChargeMinor: 415,
  initialDistanceMiles: 0.2,
  perUnitMinor: 65,
  unitDistanceMiles: 0.2,
  perSlowUnitMinor: 65,
  slowUnitSeconds: 60,
  slowSpeedMph: 12,

  zones: [airport('sfo', 'SFO Airport', 37.6213, -122.379, 3000)],
  flatFares: [],
  surcharges: [
    {
      id: 'sfo_pickup',
      label: 'SFO airport pickup fee',
      amountMinor: 600,
      // "SFO pick-up fee is $6.00 ... There is NO DROP-OFF FEE at San Francisco
      // International Airport." Charging it on arrival was a straight $6 error.
      when: { pickupInZone: 'sfo' },
    },
  ],
};

// ── Boston ─────────────────────────────────────────────────────────────────
/**
 * Source: Boston Police Department Hackney Carriage Unit rate schedule, which
 * is the regulator for Boston taxis.
 *
 * Published as "First 1/7 Mile: $2.60. Each 1/7 Mile thereafter .40" with
 * idling at $28.00/hour. The hourly rate converts to 47c per minute
 * ($28.00 / 60 = $0.4667, and the meter ticks in whole cents).
 *
 * Boston publishes no Logan flat fare — only the $2.75 toll on trips from
 * Boston to the airport, which is modelled as a surcharge.
 */
const BOSTON: Tariff = {
  marketId: 'boston',
  marketName: 'Boston',
  timeZone: 'America/New_York',
  currency: 'USD',
  authority: 'the Boston Police Hackney Carriage Unit',
  sourceUrl: 'https://police.boston.gov/taxi-rates/',
  verifiedOn: '2026-09-04',

  initialChargeMinor: 260,
  initialDistanceMiles: 1 / 7,
  perUnitMinor: 40,
  unitDistanceMiles: 1 / 7,
  perSlowUnitMinor: 47,
  slowUnitSeconds: 60,
  slowSpeedMph: 12,

  zones: [airport('bos', 'Logan Airport', 42.3656, -71.0096, 2500)],
  flatFares: [],
  surcharges: [
    {
      id: 'logan_toll',
      label: 'Logan Airport tunnel toll',
      amountMinor: 275,
      // "$2.75 toll for all trips FROM Boston proper TO Logan Airport." The
      // inbound trip does not pay it.
      when: { dropoffInZone: 'bos' },
    },
  ],
};

// ── Philadelphia ───────────────────────────────────────────────────────────
/**
 * Source: Philadelphia Parking Authority taxicab tariffs.
 *
 * Published as "First 1/10 mile (flag drop) or fraction thereof: $2.70. Each
 * additional 1/10 mile or fraction thereof: $0.30. Each 37.6 seconds of wait
 * time: $0.30" — an oddly precise time unit that comes from dividing an hourly
 * rate, and is kept exactly rather than rounded to 38 seconds.
 *
 * Philadelphia also runs a flat fare like New York's: $32.00 between the
 * Center City Zone and the airport, in either direction.
 */
const CENTER_CITY: Zone = {
  id: 'center_city',
  label: 'Center City Philadelphia',
  shape: {
    kind: 'polygon',
    // Vine Street to South Street, river to river — the PPA's flat-fare zone.
    ring: [
      [-75.1835, 39.9585],
      [-75.14, 39.9585],
      [-75.14, 39.9405],
      [-75.1835, 39.9405],
      [-75.1835, 39.9585],
    ],
  },
};

const PHILADELPHIA: Tariff = {
  marketId: 'philadelphia',
  marketName: 'Philadelphia',
  timeZone: 'America/New_York',
  currency: 'USD',
  authority: 'the Philadelphia Parking Authority',
  sourceUrl: 'https://philapark.org/taxicab-tariffs/',
  verifiedOn: '2026-09-04',

  initialChargeMinor: 270,
  initialDistanceMiles: 0.1,
  perUnitMinor: 30,
  unitDistanceMiles: 0.1,
  perSlowUnitMinor: 30,
  // 37.6 seconds exactly, as published.
  slowUnitSeconds: 37.6,
  slowSpeedMph: 12,

  zones: [
    CENTER_CITY,
    airport('phl', 'Philadelphia International Airport', 39.8744, -75.2424, 3000),
  ],

  flatFares: [
    {
      id: 'phl_center_city',
      label: 'PHL ↔ Center City flat fare',
      betweenZones: ['phl', 'center_city'],
      amountMinor: 3200,
    },
  ],

  surcharges: [
    {
      id: 'airport_egress',
      label: 'Airport egress fee',
      amountMinor: 150,
      // "added to metered fares leaving the airport".
      when: { pickupInZone: 'phl', meteredOnly: true },
    },
    {
      id: 'fuel',
      label: 'Fuel surcharge',
      amountMinor: 130,
      // The PPA re-sets this monthly. It expires with the month it was read in
      // so a stale figure cannot quietly ride along on every Philadelphia fare.
      expiresOn: '2026-09-30',
    },
  ],
  // "$1.00 per passenger surcharge for each additional passenger after the
  // first", on airport trips.
  passengerCharges: { firstExtraMinor: 100, eachAdditionalMinor: 100 },
};

// ── Seattle / King County ──────────────────────────────────────────────────
/**
 * Source: King County rule FIN 86 PR, the joint City of Seattle / King County
 * taxicab meter rate. Seattle and unincorporated King County share one card,
 * which is why the market is named for the region rather than the city.
 *
 * "Drop charge $2.60 for the first 1/9 mile ... $0.30 for each 1/9 mile or
 * fraction thereof ... waiting time $0.30 per 36 seconds when the taxicab
 * speed is below 12 mph." The $0.10 wheelchair-accessible fee is already
 * inside the $2.60 drop, so it is not modelled again as a surcharge.
 *
 * Note the passenger rule: "$0.50 per passenger over two persons". Two people
 * ride for the base fare here, unlike Chicago or DC where the charge starts at
 * the second — `freeUpTo` exists for exactly this difference.
 *
 * No Sea-Tac surcharge is modelled. The airport is Port of Seattle property
 * and its fees are not in this rule; a figure we cannot cite is one we do not
 * charge.
 */
const SEATTLE: Tariff = {
  marketId: 'seattle',
  marketName: 'Seattle',
  timeZone: 'America/Los_Angeles',
  currency: 'USD',
  authority: 'King County and the City of Seattle (rule FIN 86 PR)',
  sourceUrl:
    'https://kingcounty.gov/en/dept/executive-services/data-information-services/policies/rules/finance/fin86pr',
  verifiedOn: '2026-09-04',

  initialChargeMinor: 260,
  initialDistanceMiles: 1 / 9,
  perUnitMinor: 30,
  unitDistanceMiles: 1 / 9,
  perSlowUnitMinor: 30,
  slowUnitSeconds: 36,
  slowSpeedMph: 12,

  zones: [airport('sea', 'Seattle-Tacoma International Airport', 47.4502, -122.3088, 3000)],
  flatFares: [],
  surcharges: [],
  passengerCharges: { freeUpTo: 2, firstExtraMinor: 50, eachAdditionalMinor: 50 },
};

// ── Market lookup ──────────────────────────────────────────────────────────
/**
 * A rate card applies where the regulator's writ runs, so the market is
 * selected by the PICKUP point — and by the jurisdiction's actual shape, not a
 * rectangle around it.
 *
 * This used to be a bounding box per market, and boxes do not respect state
 * lines. A rectangle drawn around New York City reaches across the Hudson, so
 * a pickup in Newark or Jersey City matched New York and was quoted on the TLC
 * meter — a New Jersey trip priced by a New York rate card, presented as a
 * regulated fare. Chicago's box reached north over Howard Street and did the
 * same to Evanston. Those are not gaps, they are confident wrong answers, and
 * they are the failure this product exists to avoid.
 *
 * So each market carries polygons of the territory its regulator governs. The
 * box survives as a cheap first test: if the point is outside it, no polygon
 * can contain it.
 *
 * The rings are hand-traced and deliberately a little conservative at the
 * edges. Being slightly small means occasionally declining a trip we could have
 * priced, which costs a quote. Being slightly large means pricing a trip in a
 * jurisdiction that sets its own fares, which costs the truth.
 */
interface MarketBounds {
  tariff: Tariff;
  /** Cheap pre-filter; must contain every ring. */
  bbox: BBox;
  /** Pickup must fall inside one of these for the card to apply. */
  rings: Ring[];
  /**
   * Holes. Some municipalities are surrounded by the city that does not govern
   * them — Oak Park and Cicero are wrapped by Chicago on three sides — so no
   * single outline can exclude them. A pickup inside one of these is outside
   * the market, whatever the rings say.
   */
  excludes?: Ring[];
}

/**
 * New York City, five boroughs.
 *
 * The western edge follows the NY/NJ line down the middle of the Hudson, so
 * Hoboken, Jersey City, Bayonne and Newark are outside it. The northern edge is
 * the Westchester line — Yonkers and Scarsdale are outside — and the eastern
 * edge is the Nassau line.
 */
const NYC_RING: Ring = [
  [-73.9067, 40.9176], // Riverdale, at the Yonkers line
  [-73.7845, 40.913], // Wakefield, north Bronx
  [-73.7654, 40.8712], // Pelham Bay
  [-73.73, 40.79], // the Nassau line — Great Neck is east of it
  [-73.73, 40.74], // Bellerose
  [-73.735, 40.59], // Far Rockaway
  [-73.9, 40.54], // Breezy Point
  [-74.04, 40.57], // Lower New York Bay
  [-74.06, 40.495], // Staten Island, south shore
  [-74.259, 40.495], // Staten Island, south-west
  [-74.205, 40.64], // Arthur Kill, at the NJ line
  [-74.05, 40.645], // Kill Van Kull, below Bayonne
  [-74.02, 40.7], // Upper Bay, mid-channel
  [-74.017, 40.756], // Hudson at Midtown, mid-river
  [-73.954, 40.834], // Hudson at Washington Heights
  [-73.923, 40.88], // Hudson at Inwood
  [-73.9067, 40.9176],
];

/**
 * Chicago city limits, plus the O'Hare corridor.
 *
 * O'Hare is a detached parcel joined to the city by a narrow strip along Foster
 * Avenue, which is why it needs its own ring. Evanston sits north of Howard
 * Street and licenses its own taxis, so the northern edge stops there.
 */
const CHICAGO_RING: Ring = [
  [-87.84, 42.019], // Howard St at the Evanston line
  [-87.524, 42.019], // Rogers Park, lakefront
  [-87.524, 41.7], // lakefront, south side
  [-87.53, 41.644], // city line at 138th
  [-87.74, 41.644], // Hegewisch / Riverdale line
  [-87.74, 41.76], // west, southern half
  [-87.83, 41.76], // Clearing / Midway
  [-87.83, 41.81], // west of Midway
  [-87.7745, 41.86], // Austin Boulevard — the city line
  [-87.7745, 41.91], // Austin, north
  [-87.84, 41.95], // Dunning
  [-87.84, 42.019],
];

/**
 * Enclaves Chicago wraps around but does not govern. Each licenses its own
 * taxis, and no single outline of the city can exclude them.
 */
const CHICAGO_EXCLUDES: Ring[] = [
  // Oak Park and River Forest.
  [
    [-87.81, 41.916],
    [-87.774, 41.916],
    [-87.774, 41.872],
    [-87.81, 41.872],
    [-87.81, 41.916],
  ],
  // Cicero and Berwyn.
  [
    [-87.8, 41.862],
    [-87.737, 41.862],
    [-87.737, 41.818],
    [-87.8, 41.818],
    [-87.8, 41.862],
  ],
];
const OHARE_RING: Ring = [
  [-87.94, 41.95],
  [-87.86, 41.95],
  [-87.86, 42.0],
  [-87.94, 42.0],
  [-87.94, 41.95],
];

/**
 * The District of Columbia — a square rotated forty-five degrees, minus the
 * part of Virginia returned in 1846. The Potomac is the western edge, so
 * Arlington and Alexandria are outside it, and so are both airports.
 */
const DC_RING: Ring = [
  [-77.041, 38.9958], // north corner
  [-76.9094, 38.8934], // east corner
  [-77.0392, 38.7916], // south corner
  [-77.035, 38.83], // Potomac, off Bolling
  [-77.045, 38.865], // Potomac, off the Tidal Basin
  [-77.07, 38.895], // Potomac, off Georgetown
  [-77.1198, 38.9343], // west corner, at Dalecarlia
  [-77.041, 38.9958],
];

/**
 * Reagan National sits on the Virginia bank and juts into the river, so a
 * boundary traced down the Potomac catches its edge. A cab picking up there is
 * Virginia-regulated, and the DC card has no rule that mentions the airport.
 */
const DC_EXCLUDES: Ring[] = [
  [
    [-77.052, 38.862],
    [-77.03, 38.862],
    [-77.03, 38.839],
    [-77.052, 38.839],
    [-77.052, 38.862],
  ],
];

/**
 * The City and County of San Francisco, plus SFO.
 *
 * The airport is in San Mateo County, but SFMTA-medallion cabs hold pickup
 * rights there and charge the SF meter plus the published $6 pick-up fee — so
 * it belongs to this market even though it is outside the city line. Daly City
 * and Brisbane, between the two, do not.
 */
const SF_RING: Ring = [
  [-122.515, 37.81], // Land's End
  [-122.38, 37.81], // north-east, at the bay
  [-122.355, 37.73], // Hunters Point
  [-122.38, 37.708], // county line at the bay
  [-122.51, 37.708], // county line at the ocean
  [-122.515, 37.81],
];
const SFO_RING: Ring = [
  [-122.405, 37.65],
  [-122.35, 37.65],
  [-122.35, 37.605],
  [-122.405, 37.605],
  [-122.405, 37.65],
];

/**
 * Boston and the meter-rate communities.
 *
 * Deliberately regional: the Hackney Carriage rate schedule states that these
 * rates apply in Boston and in roughly eighty named cities and towns around it,
 * so Cambridge, Somerville, Brookline and Newton are genuinely on this card.
 */
const BOSTON_RING: Ring = [
  [-71.26, 42.44],
  [-70.98, 42.44],
  [-70.95, 42.25],
  [-71.2, 42.22],
  [-71.26, 42.32],
  [-71.26, 42.44],
];

/** Philadelphia city and county — the PPA's writ stops at the county line. */
const PHILADELPHIA_RING: Ring = [
  [-75.28, 40.138], // north-west, Andorra
  [-75.015, 40.138], // north-east, at the Bucks line
  [-74.955, 40.04], // Delaware River, Torresdale
  [-75.02, 39.92], // Delaware River, Bridesburg
  [-75.14, 39.87], // Navy Yard
  [-75.265, 39.862], // airport, at the Delaware County line
  [-75.28, 39.95], // west, Cobbs Creek
  [-75.28, 40.138],
];

/**
 * Seattle and King County.
 *
 * Regional on purpose: rule FIN 86 PR is a joint City of Seattle and King
 * County rule, so it governs the county, Sea-Tac included.
 */
const SEATTLE_RING: Ring = [
  [-122.54, 47.78],
  [-121.9, 47.78],
  [-121.9, 47.2],
  [-122.54, 47.2],
  [-122.54, 47.78],
];

const MARKETS: MarketBounds[] = [
  {
    tariff: NYC,
    bbox: { minLat: 40.48, maxLat: 40.92, minLng: -74.27, maxLng: -73.69 },
    rings: [NYC_RING],
  },
  {
    tariff: CHICAGO,
    bbox: { minLat: 41.64, maxLat: 42.02, minLng: -87.95, maxLng: -87.52 },
    rings: [CHICAGO_RING, OHARE_RING],
    excludes: CHICAGO_EXCLUDES,
  },
  {
    tariff: DC,
    bbox: { minLat: 38.79, maxLat: 39.0, minLng: -77.12, maxLng: -76.9 },
    rings: [DC_RING],
    excludes: DC_EXCLUDES,
  },
  {
    tariff: SF,
    bbox: { minLat: 37.6, maxLat: 37.82, minLng: -122.52, maxLng: -122.34 },
    rings: [SF_RING, SFO_RING],
  },
  {
    tariff: BOSTON,
    bbox: { minLat: 42.22, maxLat: 42.44, minLng: -71.26, maxLng: -70.95 },
    rings: [BOSTON_RING],
  },
  {
    tariff: PHILADELPHIA,
    bbox: { minLat: 39.85, maxLat: 40.14, minLng: -75.29, maxLng: -74.95 },
    rings: [PHILADELPHIA_RING],
  },
  {
    tariff: SEATTLE,
    bbox: { minLat: 47.2, maxLat: 47.78, minLng: -122.54, maxLng: -121.9 },
    rings: [SEATTLE_RING],
  },
];

/**
 * Markets deliberately NOT shipped, and why — so the gap is a decision on
 * record rather than an oversight:
 *
 *   Los Angeles — LADOT blocks automated access to its rate sheet, and the
 *   secondary sources disagree on the per-mile figure ($2.80 vs $2.97). A card
 *   nobody can check against the regulator is worse than no card at all.
 *
 *   Westchester, Nassau, northern New Jersey — taxi fares there are set by each
 *   municipality rather than by a county or state authority, so "the rate card
 *   for Scarsdale" is a document per town. A yellow cab may not pick up in any
 *   of them, so no New York fare applies either, and inventing one would be the
 *   exact mistake the polygons above exist to prevent.
 */
export function tariffForPickup(pickup: Point): Tariff | null {
  for (const m of MARKETS) {
    if (!inBBox(pickup, m.bbox)) continue;
    if (m.excludes?.some((hole) => inPolygon(pickup, hole))) continue;
    if (m.rings.some((ring) => inPolygon(pickup, ring))) return m.tariff;
  }
  return null;
}

export function allTariffs(): Tariff[] {
  return MARKETS.map((m) => m.tariff);
}

/** Exposed so a test can assert every card's zones fall inside its own market. */
export function marketBounds(): ReadonlyArray<MarketBounds> {
  return MARKETS;
}

/**
 * Westchester and Nassau — where New York's "Rate #04 — Out of City Rate"
 * applies, doubling the distance rate beyond the city line. Traced generously
 * around the two counties; beyond them the TLC publishes only a negotiated
 * flat rate, which RideLens declines to price rather than invent.
 */
const WESTCHESTER_NASSAU: Ring[] = [
  // Westchester County.
  [
    [-73.98, 41.37],
    [-73.48, 41.32],
    [-73.48, 40.9],
    [-73.73, 40.9],
    [-73.92, 41.0],
    [-73.98, 41.37],
  ],
  // Nassau County, plus the western edge of Suffolk that the rule reaches.
  [
    [-73.76, 40.93],
    [-73.42, 40.93],
    [-73.42, 40.58],
    [-73.76, 40.58],
    [-73.76, 40.93],
  ],
];

/*
 * Attached after the rings are defined. New York is the only shipped card with
 * a published out-of-city rule; every other market's meter simply stops being
 * the applicable tariff at its own line, which the pickup test already handles.
 */
NYC.serviceArea = [NYC_RING];
NYC.outOfCity = {
  multiplier: 2,
  regions: WESTCHESTER_NASSAU,
  regionLabel: 'Westchester or Nassau',
};

export const COVERED_MARKETS = MARKETS.map((m) => m.tariff.marketName);
