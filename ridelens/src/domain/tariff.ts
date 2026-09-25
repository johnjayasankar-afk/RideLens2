/**
 * Regulated taxi fare engine.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THIS IS                                                             │
 * │ A licensed taxi's fare is not a market price — it is set by a public     │
 * │ authority and published as a rate card. Given the rate card and a        │
 * │ measured route, the fare is *computable*, which is exactly what the      │
 * │ meter in the cab does.                                                   │
 * │                                                                          │
 * │ Two very different outputs come out of this file, and the distinction    │
 * │ is load-bearing:                                                         │
 * │                                                                          │
 * │  • FLAT fares (JFK ↔ Manhattan is $70 by rule) are EXACT. The regulator  │
 * │    fixed the number; there is nothing to estimate. → UPFRONT_QUOTE       │
 * │                                                                          │
 * │  • METERED fares depend on time spent below the slow-traffic threshold,  │
 * │    which we cannot observe. → METERED_ESTIMATE, always as a band         │
 * │                                                                          │
 * │ WHAT THIS IS NOT                                                         │
 * │ It is not, and must never be presented as, Uber/Lyft/Empower pricing.    │
 * │ Their fares are market-set and unavailable without authorization.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * All arithmetic is in integer minor units. Rate cards store cents directly so
 * no published figure ever passes through a float.
 */
import { tollsOnRoute } from '@/domain/tolls';
import {
  distanceMeters,
  inCircle,
  inPolygon,
  inWindow,
  isUsPublicHoliday,
  isWeekday,
  localTimeIn,
  type Circle,
  type LocalTime,
  type Point,
  type Ring,
} from './geo';

const METERS_PER_MILE = 1609.344;

/** A named area used by flat fares and zone surcharges. */
export interface Zone {
  id: string;
  label: string;
  /** Airports are circles; districts are polygons. */
  shape: { kind: 'circle'; circle: Circle } | { kind: 'polygon'; ring: Ring };
}

export function inZone(p: Point, zone: Zone): boolean {
  return zone.shape.kind === 'circle'
    ? inCircle(p, zone.shape.circle)
    : inPolygon(p, zone.shape.ring);
}

/** A surcharge that applies when its condition holds. */
export interface Surcharge {
  id: string;
  label: string;
  amountMinor: number;
  /**
   * ISO date after which this charge stops being applied.
   *
   * For figures a city re-sets on a schedule. Philadelphia publishes its fuel
   * surcharge monthly, so a number transcribed in September is confidently
   * wrong in October. Rather than let it quietly go stale, the charge expires
   * on its own: the fare loses a real dollar-thirty, which is the safe way to
   * be wrong, and the explanation says the figure needs re-checking.
   */
  expiresOn?: string;
  /** Undefined means "always applies". */
  when?: {
    /** Local-time window in minutes since midnight, end exclusive. Wraps midnight. */
    window?: { startMin: number; endMin: number };
    weekdaysOnly?: boolean;
    /**
     * Not on a public holiday. New York publishes its rush-hour surcharge as
     * "4pm to 8pm weekdays, excluding holidays".
     */
    notOnHoliday?: boolean;
    /**
     * Direction matters, and getting it wrong is a real overcharge.
     *
     * Chicago's airport departure tax "applies to taxi fares leaving the
     * airports"; San Francisco charges an SFO **pick-up** fee and states there
     * is no drop-off fee; Boston's tunnel toll is "for all trips from Boston
     * proper to Logan Airport". Each of those was once modelled as
     * `touchesZone` and so was billed in both directions.
     */
    pickupInZone?: string;
    dropoffInZone?: string;
    /** Applies if either endpoint is inside this zone. */
    touchesZone?: string;
    /** Applies only when the trip is metered (not a flat fare). */
    meteredOnly?: boolean;
    /** Applies only when the trip is on a flat fare. */
    flatOnly?: boolean;
  };
}

/** A fixed price between two zones, which overrides the meter entirely. */
export interface FlatFare {
  id: string;
  label: string;
  /** Both endpoints must match these zones, in either direction. */
  betweenZones: [string, string];
  amountMinor: number;
}

export interface Tariff {
  marketId: string;
  marketName: string;
  timeZone: string;
  currency: string;
  /** Where the numbers came from, and when they were checked. */
  authority: string;
  sourceUrl: string;
  verifiedOn: string;

  /** Charged on entry, covering `initialDistanceMiles`. */
  initialChargeMinor: number;
  initialDistanceMiles: number;
  /** Charged per `unitDistanceMiles` travelled beyond the initial distance. */
  perUnitMinor: number;
  unitDistanceMiles: number;
  /**
   * Slow-traffic charge: `perSlowUnitMinor` for every `slowUnitSeconds` spent
   * below `slowSpeedMph`. Cities differ — New York bills 70c per 60s, Chicago
   * 31c per 45s — so the increment is part of the card rather than assumed.
   */
  perSlowUnitMinor: number;
  slowUnitSeconds: number;
  slowSpeedMph: number;

  zones: Zone[];
  flatFares: FlatFare[];
  surcharges: Surcharge[];
  /**
   * What the meter adds for people beyond the first.
   *
   * Chicago and DC both publish one; ignoring it understates a fare for any
   * group, and the app already knows the party size.
   */
  /**
   * Where the standard meter applies — normally the market's own territory.
   * Optional: a card with no out-of-city rule does not need it.
   */
  serviceArea?: Ring[];

  /**
   * What happens past the service area.
   *
   * New York publishes two: "Rate #04 — Out of City Rate to Nassau or
   * Westchester", where the metered fare is **double** from the city limit to
   * the destination, and "Rate #05 — Out of City Negotiated Flat Rate" for
   * anywhere else, which is agreed between driver and passenger before the
   * trip. A negotiated fare has no published number, so there is nothing
   * honest to display for it.
   */
  outOfCity?: {
    /** Multiplier on the distance rate beyond the service area. */
    multiplier: number;
    /** Where that multiplier applies. Beyond these, the fare is negotiated. */
    regions: Ring[];
    /** For the fare breakdown, e.g. "Westchester and Nassau". */
    regionLabel: string;
  };

  passengerCharges?: {
    /**
     * How many people ride free of a per-head charge. Chicago and DC charge
     * from the second passenger (1); King County charges "per passenger over
     * two persons" (2). Getting this wrong is a silent overcharge on every
     * couple travelling together.
     */
    freeUpTo?: number;
    /** Charged once, for the first person beyond `freeUpTo`. */
    firstExtraMinor: number;
    /** Charged for each person after that. */
    eachAdditionalMinor: number;
  };
}

export interface RouteMeasurement {
  distanceMeters: number;
  /** Routed duration. Free-flow unless the routing service models traffic. */
  durationSeconds: number;
  /**
   * The routed polyline, [lng, lat]. Optional: without it the fare is still
   * correct on the meter, it simply cannot see a tolled crossing.
   */
  coordinates?: ReadonlyArray<readonly [number, number]>;
}

export interface FareContext {
  pickup: Point;
  destination: Point;
  /** Defaults to now; injected in tests for deterministic surcharge windows. */
  at?: Date;
  /** Defaults to 1. Only affects markets that publish a per-passenger charge. */
  passengers?: number;
}

export interface FareComponent {
  /**
   * Stable identifier for code. Labels are prose for humans and change freely;
   * anything selecting a component must match on this instead.
   */
  key: string;
  label: string;
  amountMinor: number;
  /** True when the amount varies with unobservable traffic. */
  uncertain?: boolean;
}

export interface FareResult {
  /**
   * NEGOTIATED means the regulator publishes no number for this trip — New
   * York's Rate #05, agreed between driver and passenger before departure.
   * There is no price to show, and `minMinor`/`maxMinor` are zero.
   */
  kind: 'FLAT' | 'METERED' | 'NEGOTIATED';
  /** Cheapest defensible total: zero slow-traffic time. */
  minMinor: number;
  /** Total including the modelled stop-and-go allowance. Equals min for flat. */
  maxMinor: number;
  currency: string;
  components: FareComponent[];
  /** Human-readable, shown in the ride detail sheet. */
  explanation: string[];
  distanceMeters: number;
  durationSeconds: number;
  localTime: LocalTime;
}

/**
 * Assumed unimpeded urban speed, used to split routed duration into
 * "moving" and "stop-and-go" time.
 *
 * The meter charges by distance above the slow threshold and by time below it.
 * With only a total distance and duration we cannot know the split, so the
 * band runs from "no slow time at all" to "every second the route takes beyond
 * free-flow is charged as slow time". 24 mph is a conservative urban figure:
 * higher would understate the band, lower would overstate it.
 */
export const URBAN_FREE_FLOW_MPH = 24;

/**
 * Boundary tolerance, in metres.
 *
 * A meter ticks when the vehicle *crosses* a unit boundary. Routing services
 * report distance rounded to whole metres, so a trip that is exactly N units
 * long often arrives as N units plus a fraction of a metre — and a naive
 * `ceil` then charges a whole extra unit.
 *
 * Measured across 1,600 exact unit boundaries in the shipped rate cards, that
 * naive form overcharged on 801 of them: 70c of phantom fare on roughly half
 * of all New York trips. Two metres of tolerance absorbs the rounding while
 * remaining far smaller than any real unit (the smallest shipped unit is 1/9
 * mile, about 179 m).
 */
const BOUNDARY_TOLERANCE_METERS = 2;

/**
 * Units a meter would tick over `billableMeters`, rounding up on a genuine
 * crossing but not on measurement noise.
 */
export function meterUnits(billableMeters: number, unitMiles: number): number {
  if (billableMeters <= 0) return 0;
  const unitMeters = unitMiles * METERS_PER_MILE;
  const toleranceUnits = BOUNDARY_TOLERANCE_METERS / unitMeters;
  return Math.max(0, Math.ceil(billableMeters / unitMeters - toleranceUnits));
}

/** True when the point is inside any of the rings. */
function inAnyRing(p: Point, rings: Ring[] | undefined): boolean {
  return Boolean(rings?.some((r) => inPolygon(p, r)));
}

/**
 * How much of a routed line lies inside the service area, and how much beyond.
 *
 * Each segment is attributed by its midpoint. The error that introduces is at
 * most half a segment at the single crossing point, which on a routed polyline
 * is a few tens of metres — far below the unit the meter charges in.
 *
 * Returns null when there is no polyline to walk. That is not a licence to
 * guess: without it we cannot know where the city line falls, and a fare that
 * silently charges the whole distance at the inside rate would understate a
 * trip the regulator says costs double beyond it.
 */
function splitAtServiceArea(
  coordinates: ReadonlyArray<readonly [number, number]> | undefined,
  rings: Ring[],
  totalMeters: number,
): { insideMeters: number; outsideMeters: number } | null {
  if (!coordinates || coordinates.length < 2) return null;
  let inside = 0;
  let outside = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const a = coordinates[i - 1]!;
    const b = coordinates[i]!;
    const from = { lat: a[1], lng: a[0] };
    const to = { lat: b[1], lng: b[0] };
    const seg = distanceMeters(from, to);
    if (seg <= 0) continue;
    const mid = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
    if (inAnyRing(mid, rings)) inside += seg;
    else outside += seg;
  }
  const walked = inside + outside;
  if (walked <= 0) return null;
  // The polyline's own length and the routing service's reported distance
  // differ slightly; scale so the parts add back to the distance being billed.
  const scale = totalMeters / walked;
  return { insideMeters: inside * scale, outsideMeters: outside * scale };
}

export function computeFare(tariff: Tariff, route: RouteMeasurement, ctx: FareContext): FareResult {
  const localTime = localTimeIn(tariff.timeZone, ctx.at ?? new Date());
  const zonesAt = (p: Point) => tariff.zones.filter((z) => inZone(p, z)).map((z) => z.id);
  const pickupZones = zonesAt(ctx.pickup);
  const destZones = zonesAt(ctx.destination);
  const touched = new Set([...pickupZones, ...destZones]);
  const from = new Set(pickupZones);
  const to = new Set(destZones);

  const flat = tariff.flatFares.find(
    (f) =>
      (pickupZones.includes(f.betweenZones[0]) && destZones.includes(f.betweenZones[1])) ||
      (pickupZones.includes(f.betweenZones[1]) && destZones.includes(f.betweenZones[0])),
  );

  /*
   * Does this trip leave the territory the meter is written for?
   *
   * A flat fare is defined between two named zones and already answers the
   * question, so this only applies to metered trips.
   */
  /*
   * A destination the card prices by name is covered by the card, wherever it
   * sits. New York meters a trip to Newark Airport normally and adds a $20
   * surcharge — it is in New Jersey, outside the service area, and explicitly
   * published, so it is neither a doubled fare nor a negotiated one.
   */
  const destinationNamedByRule = destZones.some(
    (id) =>
      tariff.flatFares.some((f) => f.betweenZones.includes(id)) ||
      tariff.surcharges.some(
        (s) =>
          s.when?.touchesZone === id || s.when?.dropoffInZone === id || s.when?.pickupInZone === id,
      ),
  );

  const leavesService =
    !flat &&
    !destinationNamedByRule &&
    tariff.serviceArea !== undefined &&
    !inAnyRing(ctx.destination, tariff.serviceArea) &&
    inAnyRing(ctx.pickup, tariff.serviceArea);

  if (leavesService && tariff.outOfCity && !inAnyRing(ctx.destination, tariff.outOfCity.regions)) {
    // New York's Rate #05: agreed between driver and passenger before the trip.
    // There is no published number, so there is nothing honest to show.
    return {
      kind: 'NEGOTIATED',
      minMinor: 0,
      maxMinor: 0,
      currency: tariff.currency,
      components: [],
      explanation: [
        `${tariff.authority} publishes no fare for a trip from ${tariff.marketName} to this destination — beyond ${tariff.outOfCity.regionLabel} the fare is negotiated with the driver before the trip begins. RideLens will not invent a number for it.`,
      ],
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      localTime,
    };
  }

  const outOfCitySplit =
    leavesService && tariff.outOfCity && tariff.serviceArea
      ? splitAtServiceArea(route.coordinates, tariff.serviceArea, route.distanceMeters)
      : null;

  // Without a polyline we cannot know where the city line falls, and charging
  // the whole distance at the inside rate would understate a fare the regulator
  // says doubles beyond it.
  if (leavesService && tariff.outOfCity && !outOfCitySplit) {
    return {
      kind: 'NEGOTIATED',
      minMinor: 0,
      maxMinor: 0,
      currency: tariff.currency,
      components: [],
      explanation: [
        `This trip leaves ${tariff.marketName}, where the meter changes rate at the city line. Without a measured route RideLens cannot tell how much of the trip falls on each side, so it will not estimate the fare.`,
      ],
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      localTime,
    };
  }

  const outOfCity =
    outOfCitySplit && tariff.outOfCity ? { split: outOfCitySplit, rule: tariff.outOfCity } : null;

  const components: FareComponent[] = [];
  const explanation: string[] = [];
  let minMinor = 0;
  let maxMinor = 0;

  if (flat) {
    components.push({ key: `flat:${flat.id}`, label: flat.label, amountMinor: flat.amountMinor });
    minMinor += flat.amountMinor;
    maxMinor += flat.amountMinor;
    explanation.push(
      `${flat.label} is a fixed fare set by ${tariff.authority}. It does not change with traffic or time spent in the vehicle.`,
    );
  } else {
    const miles = route.distanceMeters / METERS_PER_MILE;
    // Metres throughout: converting to miles first and dividing there is what
    // introduces the boundary error meterUnits() exists to avoid.
    const billableMeters = Math.max(
      0,
      route.distanceMeters - tariff.initialDistanceMiles * METERS_PER_MILE,
    );
    // Meters tick a whole unit at a time; a partial unit is charged in full.
    const distanceUnits = meterUnits(billableMeters, tariff.unitDistanceMiles);
    let distanceMinor = distanceUnits * tariff.perUnitMinor;

    components.push({
      key: 'initial',
      label: `Initial charge (first ${formatMiles(tariff.initialDistanceMiles)} mi)`,
      amountMinor: tariff.initialChargeMinor,
    });

    if (outOfCity) {
      // Metered normally to the city line, then at the published multiplier
      // beyond it. New York's Rate #04 doubles.
      const insideBillable = Math.max(
        0,
        outOfCity.split.insideMeters - tariff.initialDistanceMiles * METERS_PER_MILE,
      );
      const unitsIn = meterUnits(insideBillable, tariff.unitDistanceMiles);
      const unitsOut = meterUnits(outOfCity.split.outsideMeters, tariff.unitDistanceMiles);
      const minorIn = unitsIn * tariff.perUnitMinor;
      const minorOut = unitsOut * tariff.perUnitMinor * outOfCity.rule.multiplier;
      distanceMinor = minorIn + minorOut;

      components.push({
        key: 'distance',
        label: `${unitsIn} × ${formatMiles(tariff.unitDistanceMiles)} mi in ${tariff.marketName}`,
        amountMinor: minorIn,
      });
      components.push({
        key: 'distance_out_of_city',
        label: `${unitsOut} × ${formatMiles(tariff.unitDistanceMiles)} mi beyond the city line, at ${outOfCity.rule.multiplier}×`,
        amountMinor: minorOut,
      });
      // "double" rather than "2 times": it is the word the rule itself uses.
      const rate =
        outOfCity.rule.multiplier === 2
          ? 'double the distance rate'
          : `${outOfCity.rule.multiplier} times the distance rate`;
      explanation.push(
        `This trip leaves ${tariff.marketName}. ${tariff.authority} meters the fare normally to the city line and then charges ${rate} from there into ${outOfCity.rule.regionLabel} — about ${Math.round(outOfCity.split.outsideMeters / METERS_PER_MILE)} of the ${Math.round(route.distanceMeters / METERS_PER_MILE)} miles.`,
      );
    } else {
      components.push({
        key: 'distance',
        label: `${distanceUnits} × ${formatMiles(tariff.unitDistanceMiles)} mi`,
        amountMinor: distanceMinor,
      });
    }

    minMinor += tariff.initialChargeMinor + distanceMinor;
    maxMinor += tariff.initialChargeMinor + distanceMinor;

    // Stop-and-go allowance: everything the routed duration takes beyond
    // free-flow is treated as chargeable slow time at the top of the band.
    const freeFlowSeconds = (miles / URBAN_FREE_FLOW_MPH) * 3600;
    const slowSeconds = Math.max(0, route.durationSeconds - freeFlowSeconds);
    // Same tolerance reasoning, one second's worth, so a rounded duration does
    // not invent a tick at the top of the band.
    const slowUnits =
      slowSeconds <= 0
        ? 0
        : Math.max(0, Math.ceil(slowSeconds / tariff.slowUnitSeconds - 1 / tariff.slowUnitSeconds));
    const slowMinor = slowUnits * tariff.perSlowUnitMinor;

    if (slowMinor > 0) {
      components.push({
        key: 'slow_time',
        label: `Up to ${Math.round(slowSeconds / 60)} min below ${tariff.slowSpeedMph} mph`,
        amountMinor: slowMinor,
        uncertain: true,
      });
      maxMinor += slowMinor;
    }

    explanation.push(
      `Computed from the ${tariff.marketName} rate card published by ${tariff.authority}: ${money(tariff.initialChargeMinor)} on entry, then ${money(tariff.perUnitMinor)} per ${formatMiles(tariff.unitDistanceMiles)} mile.`,
    );
    explanation.push(
      slowMinor > 0
        ? `The meter also charges ${money(tariff.perSlowUnitMinor)} for every ${tariff.slowUnitSeconds} seconds below ${tariff.slowSpeedMph} mph. Traffic is not observable from here, so the range runs from no slow time at all up to about ${Math.round(slowSeconds / 60)} minutes of it.`
        : `This route is fast enough that no slow-traffic time is expected, so the meter should track distance alone.`,
    );
  }

  for (const s of tariff.surcharges) {
    if (!surchargeApplies(s, { localTime, touched, from, to, isFlat: Boolean(flat) })) continue;
    if (surchargeExpired(s, localTime)) {
      explanation.push(
        `${tariff.marketName}'s ${s.label.toLowerCase()} is set on a schedule and the figure on file has passed its date, so it is left out rather than guessed. The real fare may be up to ${money(s.amountMinor)} higher.`,
      );
      continue;
    }
    components.push({ key: `surcharge:${s.id}`, label: s.label, amountMinor: s.amountMinor });
    minMinor += s.amountMinor;
    maxMinor += s.amountMinor;
  }

  // Extra passengers, where the city charges for them.
  const passengers = Math.max(1, Math.floor(ctx.passengers ?? 1));
  const pc = tariff.passengerCharges;
  const freeUpTo = pc?.freeUpTo ?? 1;
  if (pc && passengers > freeUpTo) {
    const extra = passengers - freeUpTo;
    const amountMinor = pc.firstExtraMinor + (extra - 1) * pc.eachAdditionalMinor;
    components.push({
      key: 'passengers',
      label: `${extra} chargeable passenger${extra === 1 ? '' : 's'}`,
      amountMinor,
    });
    minMinor += amountMinor;
    maxMinor += amountMinor;
    const ordinal = freeUpTo === 1 ? 'second' : freeUpTo === 2 ? 'third' : `${freeUpTo + 1}th`;
    explanation.push(
      pc.firstExtraMinor === pc.eachAdditionalMinor
        ? `${tariff.marketName} charges ${money(pc.firstExtraMinor)} for each passenger from the ${ordinal} onwards.`
        : `${tariff.marketName} charges ${money(pc.firstExtraMinor)} for the ${ordinal} passenger and ${money(pc.eachAdditionalMinor)} for each one after that.`,
    );
  }

  if (tariff.surcharges.some((s) => s.when?.window)) {
    explanation.push(
      `Time-of-day surcharges are evaluated against the current local time in ${tariff.marketName} (${String(localTime.hour).padStart(2, '0')}:${String(localTime.minute).padStart(2, '0')}).`,
    );
  }
  // Tolls: only where the route demonstrably goes through one, and only at the
  // top of the band, because the driver chooses the road and most of these
  // crossings have a free alternative a few blocks away.
  const tolls = route.coordinates ? tollsOnRoute(tariff.marketId, route.coordinates) : [];
  for (const t of tolls) {
    components.push({
      key: `toll:${t.id}`,
      label: t.label,
      amountMinor: t.amountMinor,
      uncertain: true,
    });
    maxMinor += t.amountMinor;
  }

  if (tolls.length > 0) {
    const names = tolls.map((t) => t.label.replace(/ toll$/, ''));
    explanation.push(
      `This route goes through ${names.length === 1 ? 'a tolled crossing' : 'tolled crossings'} — ${names.join(', ')} — and the passenger pays ${names.length === 1 ? 'that toll' : 'those tolls'} on top of the meter. The driver picks the road, and there is usually a free way across, so ${names.length === 1 ? 'it sits' : 'they sit'} at the top of the range rather than in the base fare.`,
    );
    explanation.push('Gratuity is not included.');
  } else {
    explanation.push('Tolls and gratuity are not included; both are added at the end of the trip.');
  }

  return {
    kind: flat ? 'FLAT' : 'METERED',
    minMinor,
    maxMinor,
    currency: tariff.currency,
    components,
    explanation,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    localTime,
  };
}

function surchargeApplies(
  s: Surcharge,
  ctx: {
    localTime: LocalTime;
    touched: Set<string>;
    from: Set<string>;
    to: Set<string>;
    isFlat: boolean;
  },
): boolean {
  const w = s.when;
  if (!w) return true;
  if (w.meteredOnly && ctx.isFlat) return false;
  if (w.flatOnly && !ctx.isFlat) return false;
  if (w.pickupInZone && !ctx.from.has(w.pickupInZone)) return false;
  if (w.dropoffInZone && !ctx.to.has(w.dropoffInZone)) return false;
  if (w.touchesZone && !ctx.touched.has(w.touchesZone)) return false;
  if (w.weekdaysOnly && !isWeekday(ctx.localTime)) return false;
  if (w.notOnHoliday && isUsPublicHoliday(ctx.localTime)) return false;
  if (w.window && !inWindow(ctx.localTime, w.window.startMin, w.window.endMin)) return false;
  return true;
}

/** A charge whose published figure has aged out is not charged. */
function surchargeExpired(s: Surcharge, localTime: LocalTime): boolean {
  if (!s.expiresOn) return false;
  const today = `${localTime.year}-${String(localTime.month).padStart(2, '0')}-${String(localTime.day).padStart(2, '0')}`;
  return today > s.expiresOn;
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function formatMiles(m: number): string {
  // 0.2 → "1/5", 0.125 → "1/8", so the label matches how the rule is written.
  //
  // 7 belongs in this list. Boston bills per 1/7 mile, and without it the card
  // read "first 0.14285714285714285 mi" — a true number that no rate card has
  // ever printed. Any unit a shipped tariff uses must have a fraction here, and
  // a test asserts that rather than trusting the list to stay complete.
  const denominators = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16];
  for (const d of denominators) {
    if (Math.abs(m - 1 / d) < 1e-9) return `1/${d}`;
  }
  // Not a unit fraction: show at most three decimals rather than a full float.
  return Number.isInteger(m) ? String(m) : m.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
