/**
 * Marketplace dynamics — simulated real-time pricing without partner APIs.
 *
 * Models what TNCs / taxi typically optimize for:
 * - Continuous time-of-day & day-of-week demand curves (not flat hour buckets)
 * - Pickup / destination zone heat (airports, core CBD, nightlife, bridges)
 * - Provider personality (Uber vs Lyft vs Empower vs Curb/taxi rules)
 * - Product elasticity (XL / Comfort surge more than standard)
 * - Supply–demand imbalance → wait + price coupling
 * - Minute-scale volatility that is deterministic per tick (refresh changes quotes)
 *
 * This is an estimate model calibrated to published rate cards + public studies.
 * It is NOT a live Uber/Lyft quote. Final fare is always confirmed in-app.
 */

import { hotspotHeat } from "@/lib/sources/ratecard/hotspots";

export type MarketplaceProvider = "uber" | "lyft" | "empower" | "curb";

export type MarketplaceProduct =
  | "uberx"
  | "comfort"
  | "uberxl"
  | "lyft"
  | "lyft_xl"
  | "taxi"
  | "empower";

export type MarketplaceState = {
  /** Multiplier on metered TNC fare (taxi uses 1 + additive peaks). */
  multiplier: number;
  /** Extra traffic duration factor on top of TOD traffic. */
  trafficBoost: number;
  /** Multiplier applied to modeled pickup wait. */
  waitBoost: number;
  /** Additive dollars (taxi peak / night surcharges, micro fees). */
  additiveDollars: number;
  /** Human-readable composite label for UI metadata. */
  label: string;
  /** Transparent factor breakdown (debug / admin). */
  factors: Record<string, number>;
  /** Marketplace tick id (~55s buckets). */
  tickEpoch: number;
  /** Seconds until next tick (for UI “prices move”). */
  secondsToNextTick: number;
};

const TICK_MS = 55_000;

/** Deterministic 32-bit hash (FNV-1a style). */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Uniform [0, 1) from seed. */
export function unitNoise(seed: number): number {
  let x = seed || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 10_000) / 10_000;
}

/** Smooth gaussian bump centered at `mu` hours (0–24), width `sigma`. */
function gaussHour(hourFloat: number, mu: number, sigma: number): number {
  let d = hourFloat - mu;
  if (d > 12) d -= 24;
  if (d < -12) d += 24;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

function hourFloat(now: Date): number {
  return (
    now.getHours() +
    now.getMinutes() / 60 +
    now.getSeconds() / 3600 +
    now.getMilliseconds() / 3_600_000
  );
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function inManhattanCore(lat: number, lng: number): boolean {
  return lat > 40.7 && lat < 40.82 && lng > -74.02 && lng < -73.93;
}

function inNycNightlife(lat: number, lng: number): boolean {
  return (
    (lat > 40.71 && lat < 40.74 && lng > -74.0 && lng < -73.97) ||
    (lat > 40.71 && lat < 40.725 && lng > -73.97 && lng < -73.95) ||
    (lat > 40.75 && lat < 40.77 && lng > -74.0 && lng < -73.97)
  );
}

const AIRPORTS = [
  { id: "jfk", lat: 40.6413, lng: -73.7781, r: 3.2 },
  { id: "lga", lat: 40.7769, lng: -73.874, r: 2.6 },
  { id: "ewr", lat: 40.6895, lng: -74.1745, r: 3.0 },
  { id: "lax", lat: 33.9425, lng: -118.408, r: 3.5 },
  { id: "sfo", lat: 37.6213, lng: -122.379, r: 3.0 },
  { id: "ord", lat: 41.9742, lng: -87.9073, r: 3.2 },
  { id: "bos", lat: 42.3656, lng: -71.0096, r: 2.8 },
];

function nearAirport(p: { lat: number; lng: number }): string | null {
  for (const a of AIRPORTS) {
    if (haversineKm(p, a) <= a.r) return a.id;
  }
  return null;
}

/** ~1.1km cells — enough locality without over-fitting a single building. */
export function geoCell(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/**
 * Continuous TOD demand lift (additive on top of 1.0).
 * Peaks: weekday AM/PM commute, Fri/Sat nightlife, Sunday evening return.
 */
export function todDemandLift(
  now: Date,
  provider: MarketplaceProvider,
): { lift: number; tag: string } {
  const h = hourFloat(now);
  const dow = now.getDay();
  const weekend = dow === 0 || dow === 6;
  const fri = dow === 5;
  const sat = dow === 6;

  let lift = 0;
  let tag = "baseline";

  const am = gaussHour(h, 8.25, 1.15);
  const pm = gaussHour(h, 17.6, 1.35);
  const lunch = gaussHour(h, 12.3, 0.9);
  const late = gaussHour(h, 1.2, 1.4);
  const eveSocial = gaussHour(h, 22.0, 1.6);

  if (!weekend) {
    // RideWise NYC typical surge table: AM ~1.3×, PM ~1.4× (UberX)
    lift += am * (provider === "lyft" ? 0.28 : provider === "empower" ? 0.22 : 0.3);
    lift += pm * (provider === "uber" ? 0.38 : provider === "empower" ? 0.28 : 0.42);
    lift += lunch * 0.04;
    if (am > pm && am > 0.35) tag = "am_commute";
    else if (pm > 0.35) tag = "pm_commute";
  } else {
    lift += lunch * 0.06;
    lift += gaussHour(h, 15.5, 2.0) * 0.05;
    tag = "weekend_day";
  }

  if (fri || sat) {
    const nightBoost =
      eveSocial * (provider === "lyft" ? 0.32 : provider === "empower" ? 0.24 : 0.26) +
      late * (provider === "lyft" ? 0.28 : provider === "empower" ? 0.22 : 0.22);
    lift += nightBoost;
    if (eveSocial > 0.4 || late > 0.4) tag = "weekend_night";
  } else if (h >= 23 || h < 5) {
    lift += late * (provider === "empower" ? 0.12 : 0.18);
    if (late > 0.3) tag = "late_night";
  }

  if (dow === 0 && h >= 16 && h < 21) {
    lift += 0.05;
    tag = "sunday_return";
  }

  if (h >= 3 && h < 5.5) {
    lift += provider === "empower" ? 0.08 : 0.04;
    tag = "overnight_supply";
  }

  return { lift: Math.max(0, lift), tag };
}

/**
 * Zone heat from pickup + destination context.
 */
export function zoneHeat(input: {
  pickup: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  now: Date;
  provider: MarketplaceProvider;
}): { heat: number; tags: string[] } {
  const tags: string[] = [];
  let heat = 0;
  const h = hourFloat(input.now);
  const weekend = input.now.getDay() === 0 || input.now.getDay() === 6;

  const pickAir = nearAirport(input.pickup);
  const dropAir = nearAirport(input.destination);
  if (pickAir || dropAir) {
    heat += 0.08;
    tags.push(`airport_${pickAir || dropAir}`);
    if ((h >= 5.5 && h < 9) || (h >= 16 && h < 21)) {
      heat += 0.06;
      tags.push("flight_bank");
    }
  }

  if (
    inManhattanCore(input.pickup.lat, input.pickup.lng) ||
    inManhattanCore(input.destination.lat, input.destination.lng)
  ) {
    heat += 0.04;
    tags.push("manhattan_core");
  }

  if (
    weekend &&
    h >= 20 &&
    (inNycNightlife(input.pickup.lat, input.pickup.lng) ||
      inNycNightlife(input.destination.lat, input.destination.lng))
  ) {
    heat += input.provider === "lyft" ? 0.1 : 0.07;
    tags.push("nightlife_zone");
  }

  const crossRiver =
    (input.pickup.lng < -73.98 && input.destination.lng > -73.96) ||
    (input.pickup.lng > -73.96 && input.destination.lng < -73.98);
  if (crossRiver && Math.abs(input.pickup.lat - input.destination.lat) < 0.15) {
    heat += 0.03;
    tags.push("river_crossing");
  }

  const km = haversineKm(input.pickup, input.destination);
  if (km > 25) {
    heat += 0.04;
    tags.push("long_haul");
  } else if (km > 15) {
    heat += 0.02;
  }

  const pickHot = hotspotHeat(input.pickup, input.now);
  const dropHot = hotspotHeat(input.destination, input.now);
  if (pickHot.heat > 0) {
    heat += pickHot.heat;
    tags.push(...pickHot.ids.map((id) => `hot_${id}`));
  }
  if (dropHot.heat > 0.04) {
    heat += dropHot.heat * 0.45;
  }

  return { heat, tags };
}

/**
 * Seasonal / calendar proxy (no weather API).
 */
export function calendarProxy(now: Date): { lift: number; tag: string } {
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 10 && day >= 20) return { lift: 0.03, tag: "holiday_season" };
  if (month === 11 && day <= 31) return { lift: 0.04, tag: "holiday_season" };
  if (month === 0 && day === 1) return { lift: 0.12, tag: "new_years" };
  if (month === 6 && day === 4) return { lift: 0.05, tag: "july4" };
  if (month === 0 || month === 1) return { lift: 0.025, tag: "winter" };
  if (month === 6 || month === 7) return { lift: 0.02, tag: "summer_heat" };
  return { lift: 0, tag: "season_neutral" };
}

export function productElasticity(product: MarketplaceProduct): number {
  switch (product) {
    case "uberxl":
    case "lyft_xl":
      return 1.35;
    case "comfort":
      return 1.18;
    case "empower":
      return 1.25;
    case "taxi":
      return 0.35;
    default:
      return 1;
  }
}

export function providerScale(
  provider: MarketplaceProvider,
  rawDemand: number,
): number {
  switch (provider) {
    case "uber":
      // RideWise: AM ~1.3, PM ~1.4 when demand is fully peaked
      return 1 + rawDemand * 1.05;
    case "lyft":
      // Slightly more aggressive evening surge in RideWise table
      return 1 + rawDemand * 1.12;
    case "empower":
      // Driver-set fares: less classical surge, more mild TOD
      return 1 + rawDemand * 0.55 + rawDemand * rawDemand * 0.12;
    case "curb":
      return 1 + rawDemand * 0.2;
  }
}

/**
 * Minute-scale marketplace tick: smooth oscillation + seeded jump.
 */
export function microVolatility(input: {
  now: Date;
  provider: MarketplaceProvider;
  product: MarketplaceProduct;
  pickup: { lat: number; lng: number };
  destination: { lat: number; lng: number };
}): { tick: number; jitter: number; secondsToNextTick: number } {
  const ms = input.now.getTime();
  const tick = Math.floor(ms / TICK_MS);
  const secondsToNextTick = Math.max(
    1,
    Math.ceil((TICK_MS - (ms % TICK_MS)) / 1000),
  );

  const cell = `${geoCell(input.pickup.lat, input.pickup.lng)}>${geoCell(input.destination.lat, input.destination.lng)}`;
  const seed = hash32(
    `${input.provider}|${input.product}|${cell}|${tick}`,
  );
  const u = unitNoise(seed);
  const u2 = unitNoise(seed ^ 0xa5a5a5a5);

  const phase = unitNoise(hash32(`${input.provider}|${cell}`));
  const wave = Math.sin(2 * Math.PI * (ms / TICK_MS + phase));

  const amp =
    input.provider === "empower"
      ? 0.055
      : input.provider === "lyft"
        ? 0.045
        : input.provider === "uber"
          ? 0.035
          : 0.012;

  const jump = (u - 0.42) * amp * 2.2;
  const drift = wave * amp * 0.55;
  const micro = jump + drift + (u2 - 0.5) * amp * 0.25;

  return { tick, jitter: micro, secondsToNextTick };
}

/**
 * NYC yellow-cab Peak Hours / Night surcharge model (TLC rules, approx).
 */
export function taxiRuleSurcharges(now: Date): {
  dollars: number;
  tags: string[];
} {
  const h = hourFloat(now);
  const dow = now.getDay();
  const weekend = dow === 0 || dow === 6;
  const tags: string[] = [];
  let dollars = 0;

  if (!weekend && h >= 16 && h < 20) {
    dollars += 2.5;
    tags.push("taxi_peak_hours");
  }
  if (h >= 20 || h < 6) {
    dollars += 1.0;
    tags.push("taxi_night");
  }
  if (dow === 0 && h >= 6 && h < 20) {
    dollars += 0.75;
    tags.push("taxi_sunday");
  }

  return { dollars, tags };
}

export function trafficMarketplaceBoost(
  multiplier: number,
  miles: number,
  osrmMinutes: number,
): number {
  const mph =
    osrmMinutes > 0 && miles > 0 ? miles / (osrmMinutes / 60) : 18;
  let boost = 1 + Math.max(0, multiplier - 1) * 0.55;
  if (mph < 10) boost *= 1.06;
  if (mph < 7) boost *= 1.08;
  return Math.min(1.45, boost);
}

export function waitMarketplaceBoost(
  provider: MarketplaceProvider,
  multiplier: number,
): number {
  const excess = Math.max(0, multiplier - 1);
  const base =
    provider === "empower"
      ? 1 + excess * 1.8
      : provider === "lyft"
        ? 1 + excess * 1.25
        : provider === "uber"
          ? 1 + excess * 1.1
          : 1 + excess * 0.6;
  return Math.min(2.2, base);
}

/**
 * Full marketplace state for a quote at `now`.
 */
export function computeMarketplaceState(input: {
  provider: MarketplaceProvider;
  product: MarketplaceProduct;
  pickup: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  miles: number;
  osrmMinutes: number;
  now?: Date;
  /** Open-Meteo precip lift (1.0 = dry). */
  weatherSurgeLift?: number;
}): MarketplaceState {
  const now = input.now ?? new Date();
  const tod = todDemandLift(now, input.provider);
  const zone = zoneHeat({
    pickup: input.pickup,
    destination: input.destination,
    now,
    provider: input.provider,
  });
  const cal = calendarProxy(now);
  const elast = productElasticity(input.product);
  const weatherLift = input.weatherSurgeLift ?? 1;

  const rawDemand =
    (tod.lift + zone.heat + cal.lift) * elast * Math.max(1, weatherLift);

  let multiplier = providerScale(input.provider, rawDemand);
  const micro = microVolatility({
    now,
    provider: input.provider,
    product: input.product,
    pickup: input.pickup,
    destination: input.destination,
  });
  multiplier *= 1 + micro.jitter;
  // Weather also multiplies after personality (TNCs only)
  if (input.provider !== "curb" && weatherLift > 1) {
    multiplier *= 1 + (weatherLift - 1) * 0.65;
  }

  const maxMult =
    input.provider === "empower"
      ? 1.45
      : input.provider === "curb"
        ? 1.15
        : 1.85;
  multiplier = Math.min(maxMult, Math.max(0.92, multiplier));

  let additiveDollars = 0;
  const factorTags = [tod.tag, ...zone.tags, cal.tag];

  if (input.provider === "curb" || input.product === "taxi") {
    const taxi = taxiRuleSurcharges(now);
    additiveDollars += taxi.dollars;
    factorTags.push(...taxi.tags);
    multiplier = Math.min(1.12, Math.max(0.98, 1 + (multiplier - 1) * 0.35));
  }

  const feeSeed = hash32(
    `${input.provider}|fee|${micro.tick}|${geoCell(input.pickup.lat, input.pickup.lng)}`,
  );
  const feeJitter = (unitNoise(feeSeed) - 0.5) * 0.3;
  additiveDollars += Math.round(feeJitter * 100) / 100;

  const trafficBoost = trafficMarketplaceBoost(
    multiplier,
    input.miles,
    input.osrmMinutes,
  );
  const waitBoost = waitMarketplaceBoost(input.provider, multiplier);

  const factors: Record<string, number> = {
    tod_lift: Math.round(tod.lift * 1000) / 1000,
    zone_heat: Math.round(zone.heat * 1000) / 1000,
    calendar_lift: Math.round(cal.lift * 1000) / 1000,
    weather_lift: Math.round(weatherLift * 1000) / 1000,
    elasticity: elast,
    raw_demand: Math.round(rawDemand * 1000) / 1000,
    micro_jitter: Math.round(micro.jitter * 1000) / 1000,
    multiplier: Math.round(multiplier * 1000) / 1000,
    traffic_boost: Math.round(trafficBoost * 1000) / 1000,
    wait_boost: Math.round(waitBoost * 1000) / 1000,
    additive: additiveDollars,
  };

  const surgePct = Math.round((multiplier - 1) * 100);
  const label =
    surgePct >= 8
      ? `${tod.tag}+heat${surgePct}pct+tick${micro.tick}`
      : `${tod.tag}+tick${micro.tick}`;

  return {
    multiplier: Math.round(multiplier * 10000) / 10000,
    trafficBoost: Math.round(trafficBoost * 10000) / 10000,
    waitBoost: Math.round(waitBoost * 10000) / 10000,
    additiveDollars: Math.round(additiveDollars * 100) / 100,
    label: `${label}|${factorTags.filter(Boolean).slice(0, 4).join("+")}`,
    factors,
    tickEpoch: micro.tick,
    secondsToNextTick: micro.secondsToNextTick,
  };
}
