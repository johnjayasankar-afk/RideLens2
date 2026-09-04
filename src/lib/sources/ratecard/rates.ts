import cityRates from "./city-rates.json";

export type RateParts = {
  base: number;
  perMile: number;
  perMin: number;
  booking: number;
  minimum?: number;
};

export type CityRate = {
  name: string;
  uber: RateParts;
  lyft: RateParts;
  taxi: RateParts;
  surge: { morning: number; evening: number; late: number };
};

/** Approximate city centers for nearest-market matching. */
export const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  "new-york": { lat: 40.7128, lng: -74.006 },
  "los-angeles": { lat: 34.0522, lng: -118.2437 },
  chicago: { lat: 41.8781, lng: -87.6298 },
  houston: { lat: 29.7604, lng: -95.3698 },
  phoenix: { lat: 33.4484, lng: -112.074 },
  philadelphia: { lat: 39.9526, lng: -75.1652 },
  "san-antonio": { lat: 29.4241, lng: -98.4936 },
  "san-diego": { lat: 32.7157, lng: -117.1611 },
  dallas: { lat: 32.7767, lng: -96.797 },
  "san-jose": { lat: 37.3382, lng: -121.8863 },
  austin: { lat: 30.2672, lng: -97.7431 },
  jacksonville: { lat: 30.3322, lng: -81.6557 },
  "san-francisco": { lat: 37.7749, lng: -122.4194 },
  seattle: { lat: 47.6062, lng: -122.3321 },
  denver: { lat: 39.7392, lng: -104.9903 },
  "washington-dc": { lat: 38.9072, lng: -77.0369 },
  nashville: { lat: 36.1627, lng: -86.7816 },
  boston: { lat: 42.3601, lng: -71.0589 },
  "las-vegas": { lat: 36.1699, lng: -115.1398 },
  portland: { lat: 45.5152, lng: -122.6784 },
  miami: { lat: 25.7617, lng: -80.1918 },
  atlanta: { lat: 33.749, lng: -84.388 },
  minneapolis: { lat: 44.9778, lng: -93.265 },
  tampa: { lat: 27.9506, lng: -82.4572 },
  orlando: { lat: 28.5383, lng: -81.3792 },
  charlotte: { lat: 35.2271, lng: -80.8431 },
  detroit: { lat: 42.3314, lng: -83.0458 },
  "salt-lake-city": { lat: 40.7608, lng: -111.891 },
  pittsburgh: { lat: 40.4406, lng: -79.9959 },
  sacramento: { lat: 38.5816, lng: -121.4944 },
  "kansas-city": { lat: 39.0997, lng: -94.5786 },
  "st-louis": { lat: 38.627, lng: -90.1994 },
  cincinnati: { lat: 39.1031, lng: -84.512 },
  milwaukee: { lat: 43.0389, lng: -87.9065 },
  raleigh: { lat: 35.7796, lng: -78.6382 },
  memphis: { lat: 35.1495, lng: -90.049 },
  "new-orleans": { lat: 29.9511, lng: -90.0715 },
  richmond: { lat: 37.5407, lng: -77.436 },
  louisville: { lat: 38.2527, lng: -85.7585 },
  buffalo: { lat: 42.8864, lng: -78.8784 },
  rochester: { lat: 43.1566, lng: -77.6088 },
  hartford: { lat: 41.7658, lng: -72.6734 },
  tucson: { lat: 32.2226, lng: -110.9747 },
  albuquerque: { lat: 35.0844, lng: -106.6504 },
  honolulu: { lat: 21.3069, lng: -157.8583 },
  boise: { lat: 43.615, lng: -116.2023 },
  omaha: { lat: 41.2565, lng: -95.9345 },
  tulsa: { lat: 36.154, lng: -95.9928 },
  "colorado-springs": { lat: 38.8339, lng: -104.8214 },
};

/** 2026 calibrated overrides — RideWise / published rate cards (Sep 2026). */
const RATE_OVERRIDES: Record<string, Partial<CityRate>> = {
  "new-york": {
    name: "New York, NY",
    uber: { base: 2.55, perMile: 1.75, perMin: 0.35, booking: 2.75, minimum: 8.0 },
    lyft: { base: 2.5, perMile: 1.69, perMin: 0.33, booking: 2.75, minimum: 7.75 },
    taxi: { base: 3.0, perMile: 2.5, perMin: 0.5, booking: 0, minimum: 3.0 },
    // Mild residual demand only — traffic minutes carry most peak cost
    surge: { morning: 1.05, evening: 1.06, late: 1.04 },
  },
  "san-francisco": {
    uber: { base: 2.2, perMile: 1.75, perMin: 0.42, booking: 3.1, minimum: 8.0 },
    lyft: { base: 2.0, perMile: 1.65, perMin: 0.4, booking: 2.85, minimum: 7.5 },
    surge: { morning: 1.06, evening: 1.08, late: 1.04 },
  },
  "los-angeles": {
    uber: { base: 1.1, perMile: 1.05, perMin: 0.34, booking: 3.4, minimum: 7.0 },
    lyft: { base: 1.0, perMile: 0.98, perMin: 0.3, booking: 2.95, minimum: 6.5 },
    surge: { morning: 1.05, evening: 1.07, late: 1.03 },
  },
  chicago: {
    uber: { base: 1.7, perMile: 1.35, perMin: 0.28, booking: 2.3, minimum: 6.75 },
    lyft: { base: 1.55, perMile: 1.25, perMin: 0.26, booking: 2.15, minimum: 6.25 },
    surge: { morning: 1.05, evening: 1.07, late: 1.03 },
  },
};

export const CITY_RATES = cityRates as Record<string, CityRate>;

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function getCityRate(id: string): CityRate {
  const base = CITY_RATES[id]!;
  const over = RATE_OVERRIDES[id];
  if (!over) return base;
  return {
    ...base,
    ...over,
    uber: { ...base.uber, ...over.uber },
    lyft: { ...base.lyft, ...over.lyft },
    taxi: { ...base.taxi, ...over.taxi },
    surge: { ...base.surge, ...over.surge },
  };
}

export function nearestCity(lat: number, lng: number): {
  id: string;
  city: CityRate;
  distanceKm: number;
} {
  let bestId = "new-york";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [id, center] of Object.entries(CITY_CENTERS)) {
    if (!CITY_RATES[id]) continue;
    const d = haversineKm({ lat, lng }, center);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }
  return {
    id: bestId,
    city: getCityRate(bestId),
    distanceKm: bestDist,
  };
}

/**
 * Single demand factor for the moment, plus a tight uncertainty band.
 * Prefer fare-engine mildDemand + uncertaintyBand for new quotes.
 */
export function demandMultiplier(
  now: Date,
  surge: CityRate["surge"],
): { center: number; band: number; label: string } {
  const hour = now.getHours();
  const dow = now.getDay(); // 0 Sun
  const weekend = dow === 0 || dow === 6;

  if (hour >= 7 && hour < 10 && !weekend) {
    return { center: surge.morning, band: 0.025, label: "morning" };
  }
  if (hour >= 16 && hour < 20 && !weekend) {
    return { center: surge.evening, band: 0.03, label: "evening" };
  }
  if (hour >= 23 || hour < 5) {
    return { center: surge.late, band: 0.025, label: "late_night" };
  }
  if (weekend && hour >= 11 && hour < 15) {
    return { center: 1.03, band: 0.025, label: "weekend_midday" };
  }
  return { center: 1.0, band: 0.02, label: "off_peak" };
}

export function computeFareDollars(
  rates: RateParts,
  miles: number,
  minutes: number,
  multiplier: number,
): number {
  const raw =
    rates.base + rates.perMile * miles + rates.perMin * minutes + rates.booking;
  const floored = Math.max(rates.minimum ?? rates.base + rates.booking, raw);
  return floored * multiplier;
}

export function fareBand(
  centerFare: number,
  band: number,
): { low: number; high: number } {
  const low = centerFare * (1 - band);
  const high = centerFare * (1 + band);
  return { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100 };
}

const AIRPORTS = [
  { name: "JFK", lat: 40.6413, lng: -73.7781, code: "JFK" },
  { name: "LGA", lat: 40.7769, lng: -73.874, code: "LGA" },
  { name: "EWR", lat: 40.6895, lng: -74.1745, code: "EWR" },
  { name: "SFO", lat: 37.6213, lng: -122.379, code: "SFO" },
  { name: "LAX", lat: 33.9425, lng: -118.408, code: "LAX" },
  { name: "ORD", lat: 41.9742, lng: -87.9073, code: "ORD" },
  { name: "BOS", lat: 42.3656, lng: -71.0096, code: "BOS" },
] as const;

function nearAirport(
  point: { lat: number; lng: number },
  km = 3.5,
): (typeof AIRPORTS)[number] | null {
  for (const a of AIRPORTS) {
    if (haversineKm(point, a) < km) return a;
  }
  return null;
}

/** Manhattan south of 96th (approx) for congestion / flat-fare rules. */
function inManhattanCore(lat: number, lng: number): boolean {
  return lat > 40.7 && lat < 40.88 && lng > -74.02 && lng < -73.91;
}

export type TripFees = {
  airportCode: string | null;
  /** NYC yellow cab Manhattan↔JFK flat fare when applicable */
  nycJfkFlatTaxi: number | null;
  /** Small additive fees (congestion / airport access), not double-counted into flat */
  addOnDollars: number;
};

export function tripFees(
  pickup: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  cityId: string,
): TripFees {
  const aPick = nearAirport(pickup);
  const aDrop = nearAirport(destination);
  const airport = aPick || aDrop;

  let nycJfkFlatTaxi: number | null = null;
  let addOnDollars = 0;

  if (cityId === "new-york") {
    const jfkLeg =
      (aPick?.code === "JFK" && inManhattanCore(destination.lat, destination.lng)) ||
      (aDrop?.code === "JFK" && inManhattanCore(pickup.lat, pickup.lng));
    if (jfkLeg) {
      // TLC Manhattan–JFK flat fare (2024+) ~$70 + typical toll/surcharge buffer in band later
      nycJfkFlatTaxi = 70;
      addOnDollars = 0;
    } else if (airport) {
      addOnDollars = 2.5; // airport access / typical add-on, kept small
    }
    // Congestion surcharge when trip touches Manhattan core (not already flat)
    if (!jfkLeg && (inManhattanCore(pickup.lat, pickup.lng) || inManhattanCore(destination.lat, destination.lng))) {
      addOnDollars += 2.75;
    }
  } else if (airport) {
    addOnDollars = 3.5;
  }

  return {
    airportCode: airport?.code ?? null,
    nycJfkFlatTaxi,
    addOnDollars,
  };
}

/** @deprecated use tripFees */
export function airportSurcharge(
  pickup: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): number {
  return tripFees(pickup, destination, nearestCity(pickup.lat, pickup.lng).id)
    .addOnDollars;
}
