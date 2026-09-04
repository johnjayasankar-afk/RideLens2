/**
 * Pickup wait (ETA) model calibrated to public NYC / major-metro wait studies
 * and App-reported typical ranges — not a live provider ETA API.
 *
 * Anchors (standard vehicles, dense urban):
 * - Uber NYC: ~2–4 min typical (AMNY / TLC WAV contrast studies cite ~2.3 min Uber std)
 * - Lyft NYC: ~3–5 min typical (~4.1 min std in same study)
 * - Curb taxi NYC: ~3–4 min midtown; longer outer (~3.2 min inaccessible taxi avg)
 * - Empower: smaller NYC fleet → systematically longer than UberX (~+40–70%)
 * - Manhattan late-night weeknight: ~4–7 min (RideWise 2026)
 * - Outer boroughs late-night: ~8–15 min
 * - Platform avg wait vs volume: high-volume zones cluster under ~5.5 min
 *
 * Live Lyft/Curb partner ETA fields always override this model when present.
 */

export type WaitProvider = "uber" | "lyft" | "empower" | "curb" | "other";
export type WaitCategory =
  | "STANDARD"
  | "ECONOMY"
  | "XL"
  | "PREMIUM"
  | "LUXURY"
  | "WAV"
  | "ACCESSIBLE"
  | "TAXI"
  | "SHARED"
  | "EV"
  | "OTHER";

export type WaitEstimate = {
  /** Midpoint wait in seconds (for ranking / display). */
  seconds: number;
  /** Low end of displayed range (seconds). */
  lowSeconds: number;
  /** High end of displayed range (seconds). */
  highSeconds: number;
  /** Density band used. */
  density: "core" | "inner" | "outer" | "suburb" | "airport" | "sparse";
  /** Human label for methodology tooltip. */
  label: string;
  /** Confidence that this is near live-app ETA. */
  confidence: "medium" | "low";
};

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

function inPolyRough(
  lat: number,
  lng: number,
  south: number,
  north: number,
  west: number,
  east: number,
): boolean {
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

function isAirportPickup(lat: number, lng: number): boolean {
  const airports = [
    { lat: 40.6413, lng: -73.7781, r: 2.2 }, // JFK
    { lat: 40.7769, lng: -73.874, r: 1.8 }, // LGA
    { lat: 40.6895, lng: -74.1745, r: 2.0 }, // EWR
    { lat: 33.9425, lng: -118.4081, r: 2.5 }, // LAX
    { lat: 37.6213, lng: -122.379, r: 2.0 }, // SFO
    { lat: 41.9742, lng: -87.9073, r: 2.2 }, // ORD
    { lat: 42.3656, lng: -71.0096, r: 1.8 }, // BOS
  ];
  return airports.some((a) => haversineKm({ lat, lng }, a) <= a.r);
}

/**
 * Supply density at pickup — strongest predictor of wait.
 */
export function pickupDensity(
  lat: number,
  lng: number,
): WaitEstimate["density"] {
  if (isAirportPickup(lat, lng)) return "airport";

  // Manhattan / Midtown–Downtown core
  if (inPolyRough(lat, lng, 40.7, 40.82, -74.02, -73.93)) return "core";
  // Brooklyn / Queens inner, Jersey City, Bronx south
  if (inPolyRough(lat, lng, 40.62, 40.9, -74.08, -73.75)) return "inner";
  // Greater NYC metro
  if (inPolyRough(lat, lng, 40.45, 41.15, -74.35, -73.5)) return "outer";

  // Other US downtown-ish: within ~8km of a major city center
  const hubs = [
    { lat: 34.0522, lng: -118.2437 },
    { lat: 41.8781, lng: -87.6298 },
    { lat: 37.7749, lng: -122.4194 },
    { lat: 42.3601, lng: -71.0589 },
    { lat: 38.9072, lng: -77.0369 },
    { lat: 25.7617, lng: -80.1918 },
    { lat: 47.6062, lng: -122.3321 },
    { lat: 33.749, lng: -84.388 },
  ];
  const nearest = Math.min(
    ...hubs.map((h) => haversineKm({ lat, lng }, h)),
  );
  if (nearest < 6) return "inner";
  if (nearest < 18) return "outer";
  if (nearest < 40) return "suburb";
  return "sparse";
}

/** Base minutes by density for UberX-class (largest fleet). */
const UBER_BASE_MIN: Record<WaitEstimate["density"], number> = {
  core: 2.4,
  inner: 3.6,
  outer: 5.8,
  suburb: 8.5,
  airport: 7.5,
  sparse: 12,
};

/** Relative fleet / matching multipliers vs UberX-class. */
const PROVIDER_MULT: Record<WaitProvider, number> = {
  uber: 1.0,
  lyft: 1.18, // typically a bit longer than Uber in NYC studies
  curb: 1.05, // dense yellow cab supply in core; worse outer
  empower: 1.55, // smaller TLC fleet
  other: 1.25,
};

const CATEGORY_MULT: Partial<Record<WaitCategory, number>> = {
  STANDARD: 1,
  ECONOMY: 1.05,
  TAXI: 1,
  XL: 1.35,
  PREMIUM: 1.22,
  LUXURY: 1.55,
  WAV: 1.9,
  ACCESSIBLE: 1.9,
  SHARED: 1.15,
  EV: 1.08,
  OTHER: 1.2,
};

function todFactor(now: Date, density: WaitEstimate["density"]): number {
  const hour = now.getHours();
  const dow = now.getDay(); // 0 Sun
  const weekend = dow === 0 || dow === 6;

  // Late-night trough (RideWise): worst ~3–5 AM
  if (hour >= 3 && hour < 5) {
    if (density === "core") return weekend ? 1.35 : 1.55;
    if (density === "inner") return weekend ? 1.55 : 1.85;
    return weekend ? 1.9 : 2.25;
  }
  if (hour >= 1 && hour < 3) {
    return density === "core" ? 1.25 : density === "inner" ? 1.4 : 1.7;
  }
  // Bar close Fri/Sat
  if (weekend && hour >= 23) return density === "core" ? 1.15 : 1.35;
  if (weekend && hour < 1) return density === "core" ? 1.2 : 1.4;

  // Commute peaks: more demand AND more supply — slight wait bump on streets
  if (!weekend && ((hour >= 7 && hour < 10) || (hour >= 16 && hour < 19))) {
    return density === "core" ? 1.12 : 1.08;
  }

  // Midday dense = best supply
  if (hour >= 10 && hour < 16) return 0.92;

  // Evening
  if (hour >= 19 && hour < 23) return 1.05;

  return 1;
}

/**
 * Traffic / crawl: when free-flow is slow near pickup corridors,
 * cars take longer to reach you (use OSRM mph as proxy).
 */
function trafficWaitFactor(miles: number, osrmMinutes: number): number {
  if (osrmMinutes <= 0 || miles <= 0) return 1;
  const mph = miles / (osrmMinutes / 60);
  if (mph <= 8) return 1.28;
  if (mph <= 12) return 1.16;
  if (mph <= 18) return 1.08;
  if (mph >= 35) return 0.95;
  return 1;
}

function curbDensityAdjust(density: WaitEstimate["density"]): number {
  // Yellow cabs concentrate in Manhattan; scarce in suburbs
  switch (density) {
    case "core":
      return 0.88;
    case "inner":
      return 1.05;
    case "outer":
      return 1.35;
    case "airport":
      return 0.95; // taxi stands
    case "suburb":
      return 1.7;
    default:
      return 1.5;
  }
}

function roundWaitMinutes(m: number): number {
  // Apps show whole minutes; snap to nearest 0.5 then ceil display later
  return Math.max(1, Math.round(m * 2) / 2);
}

export function estimatePickupWait(input: {
  provider: WaitProvider;
  category: WaitCategory;
  pickup: { lat: number; lng: number };
  miles?: number;
  osrmMinutes?: number;
  now?: Date;
}): WaitEstimate {
  const now = input.now ?? new Date();
  const density = pickupDensity(input.pickup.lat, input.pickup.lng);
  let minutes = UBER_BASE_MIN[density];
  minutes *= PROVIDER_MULT[input.provider] ?? 1.2;
  minutes *= CATEGORY_MULT[input.category] ?? 1.15;
  minutes *= todFactor(now, density);
  minutes *= trafficWaitFactor(input.miles ?? 5, input.osrmMinutes ?? 15);
  if (input.provider === "curb") minutes *= curbDensityAdjust(density);

  // Soft cap / floor so we don't claim absurd live ETAs
  if (density === "core") minutes = Math.min(minutes, 12);
  if (density === "sparse") minutes = Math.min(minutes, 25);
  minutes = Math.max(1.5, minutes);

  const mid = roundWaitMinutes(minutes);
  // Live apps usually show a single minute or tight band (±1)
  const spread = mid <= 4 ? 1 : mid <= 8 ? 1.5 : 2.5;
  const low = Math.max(1, roundWaitMinutes(mid - spread * 0.55));
  const high = roundWaitMinutes(mid + spread * 0.65);

  return {
    seconds: Math.round(mid * 60),
    lowSeconds: Math.round(low * 60),
    highSeconds: Math.round(high * 60),
    density,
    label: `Modeled wait (${density} supply, ${input.provider})`,
    confidence: density === "sparse" || density === "suburb" ? "low" : "medium",
  };
}

export function formatWaitMinutes(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} min`;
}

export function formatWaitRange(
  lowSeconds: number | null | undefined,
  highSeconds: number | null | undefined,
  midSeconds?: number | null,
): string {
  if (midSeconds != null && (lowSeconds == null || highSeconds == null)) {
    return formatWaitMinutes(midSeconds);
  }
  if (lowSeconds == null || highSeconds == null) return "—";
  const lo = Math.max(1, Math.round(lowSeconds / 60));
  const hi = Math.max(lo, Math.round(highSeconds / 60));
  if (lo === hi) return `${lo} min`;
  return `${lo}–${hi} min`;
}
