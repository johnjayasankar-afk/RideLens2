/**
 * Fare engine: live route + published rate cards + NY regulatory fees
 * + corridor anchors + tight uncertainty.
 *
 * Sources (Sep 2026):
 * - RideWise NYC rate cards (UberX/Lyft/Comfort/XL)
 * - Uber NY surcharge blog (NYS $2.75 / MTA $1.50 / Black Car Fund)
 * - Uber published corridor averages (e.g. Scarsdale→Manhattan ~$70)
 * - WestchesterRide corridor ranges ($45–75 normal)
 */

import {
  computeFareDollars,
  getCityRate,
  nearestCity,
  type RateParts,
} from "@/lib/sources/ratecard/rates";
import {
  estimateRouteTolls,
  trafficContextFactor,
} from "@/lib/sources/ratecard/tolls";

export type LatLng = { lat: number; lng: number };

export type FareProduct =
  | "uberx"
  | "comfort"
  | "uberxl"
  | "lyft"
  | "lyft_xl"
  | "taxi"
  | "empower";

export type ComputedFare = {
  center: number;
  low: number;
  high: number;
  band: number;
  rateCardDollars: number;
  feesDollars: number;
  trafficMinutes: number;
  demandCenter: number;
  demandLabel: string;
  marketId: string;
  marketName: string;
  anchorId: string | null;
  anchorWeight: number;
  feeBreakdown: Record<string, number>;
};

/** Manhattan south of ~96th St (NYS congestion surcharge zone). */
export function inManhattanBelow96(lat: number, lng: number): boolean {
  // Rough Manhattan island polygon slice — excludes LIC / Queens false positives
  if (lat <= 40.7 || lat >= 40.795) return false;
  if (lng <= -74.02 || lng >= -73.93) return false;
  // East River cut: east of ~-73.935 above 40.74 is often Queens
  if (lng > -73.935 && lat > 40.74) return false;
  return true;
}

/** Manhattan south of ~60th St (MTA congestion relief zone). */
export function inManhattanBelow60(lat: number, lng: number): boolean {
  if (lat <= 40.7 || lat >= 40.772) return false;
  if (lng <= -74.02 || lng >= -73.935) return false;
  return true;
}

/** Rough NYC five-borough bbox. */
export function inNYC(lat: number, lng: number): boolean {
  return lat > 40.49 && lat < 40.92 && lng > -74.26 && lng < -73.7;
}

/** Westchester / southern CT fringe (Scarsdale, White Plains, Yonkers…). */
export function inWestchester(lat: number, lng: number): boolean {
  return lat >= 40.88 && lat <= 41.35 && lng >= -73.98 && lng <= -73.5;
}

/** OSRM free-flow minutes → expected in-traffic minutes by time of day. */
export function trafficDurationFactor(now: Date): {
  factor: number;
  label: string;
} {
  const hour = now.getHours();
  const dow = now.getDay();
  const weekend = dow === 0 || dow === 6;

  if (!weekend && hour >= 7 && hour < 10) {
    return { factor: 1.3, label: "morning_traffic" };
  }
  if (!weekend && hour >= 16 && hour < 20) {
    return { factor: 1.35, label: "evening_traffic" };
  }
  if (!weekend && hour >= 11 && hour < 14) {
    return { factor: 1.12, label: "midday_traffic" };
  }
  if (hour >= 23 || hour < 5) {
    return { factor: 0.95, label: "late_clear" };
  }
  if (weekend && hour >= 12 && hour < 18) {
    return { factor: 1.12, label: "weekend_day" };
  }
  return { factor: 1.05, label: "baseline_traffic" };
}

/**
 * Mild demand — do NOT model 1.3–1.5× surge into the displayed range.
 * Traffic minutes already capture most peak cost; this is residual marketplace lift.
 */
export function mildDemand(now: Date): { center: number; label: string } {
  const hour = now.getHours();
  const dow = now.getDay();
  const weekend = dow === 0 || dow === 6;

  if (!weekend && hour >= 7 && hour < 10) {
    return { center: 1.05, label: "morning" };
  }
  if (!weekend && hour >= 16 && hour < 20) {
    return { center: 1.06, label: "evening" };
  }
  if (hour >= 23 || hour < 5) {
    return { center: 1.04, label: "late_night" };
  }
  if (weekend && hour >= 20) {
    return { center: 1.05, label: "weekend_night" };
  }
  return { center: 1.0, label: "off_peak" };
}

export type NyFeeStack = {
  addOnDollars: number;
  breakdown: Record<string, number>;
  nycJfkFlatTaxi: number | null;
  crossJurisdiction: boolean;
  touchesBelow96: boolean;
  touchesBelow60: boolean;
};

export function buildNyFeeStack(
  pickup: LatLng,
  destination: LatLng,
  provider: "uber" | "lyft" | "empower" | "curb" | "taxi",
): NyFeeStack {
  const pick96 = inManhattanBelow96(pickup.lat, pickup.lng);
  const drop96 = inManhattanBelow96(destination.lat, destination.lng);
  const pick60 = inManhattanBelow60(pickup.lat, pickup.lng);
  const drop60 = inManhattanBelow60(destination.lat, destination.lng);
  const touchesBelow96 = pick96 || drop96;
  const touchesBelow60 = pick60 || drop60;

  const pickNyc = inNYC(pickup.lat, pickup.lng);
  const dropNyc = inNYC(destination.lat, destination.lng);
  const crossJurisdiction = pickNyc !== dropNyc;

  const nearJfk = (p: LatLng) =>
    Math.hypot(p.lat - 40.6413, p.lng - (-73.7781)) < 0.04;
  const jfkLeg =
    (nearJfk(pickup) && inManhattanBelow96(destination.lat, destination.lng)) ||
    (nearJfk(destination) && inManhattanBelow96(pickup.lat, pickup.lng));

  if (jfkLeg && (provider === "curb" || provider === "taxi")) {
    return {
      addOnDollars: 0,
      breakdown: { nyc_jfk_flat: 70 },
      nycJfkFlatTaxi: 70,
      crossJurisdiction,
      touchesBelow96,
      touchesBelow60,
    };
  }

  const breakdown: Record<string, number> = {};
  let addOn = 0;

  if (touchesBelow96 && provider !== "taxi" && provider !== "curb") {
    breakdown.nys_congestion_below_96 = 2.75;
    addOn += 2.75;
  } else if (touchesBelow96 && (provider === "taxi" || provider === "curb")) {
    breakdown.nys_congestion_taxi = 2.5;
    addOn += 2.5;
  }

  if (touchesBelow60 && provider !== "taxi" && provider !== "curb") {
    breakdown.mta_congestion_below_60 = 1.5;
    addOn += 1.5;
  } else if (touchesBelow60 && (provider === "taxi" || provider === "curb")) {
    breakdown.mta_congestion_taxi = 0.75;
    addOn += 0.75;
  }

  // Airport access (Port Authority) — small fixed add-on when endpoint near major NY airports
  const airports = [
    { lat: 40.6413, lng: -73.7781, fee: 2.75 }, // JFK
    { lat: 40.7769, lng: -73.874, fee: 2.75 }, // LGA
    { lat: 40.6895, lng: -74.1745, fee: 2.75 }, // EWR
  ];
  for (const a of airports) {
    if (
      Math.hypot(pickup.lat - a.lat, pickup.lng - a.lng) < 0.035 ||
      Math.hypot(destination.lat - a.lat, destination.lng - a.lng) < 0.035
    ) {
      breakdown.port_authority = a.fee;
      addOn += a.fee;
      break;
    }
  }

  // Non-NYC origin into Congestion Relief Zone — Uber “Congestion Zone Fund” flat pass-through
  if (
    !pickNyc &&
    touchesBelow60 &&
    provider !== "taxi" &&
    provider !== "curb"
  ) {
    breakdown.non_nyc_crz_fund = 2.0;
    addOn += 2.0;
  }

  return {
    addOnDollars: addOn,
    breakdown,
    nycJfkFlatTaxi: null,
    crossJurisdiction,
    touchesBelow96,
    touchesBelow60,
  };
}

type CorridorAnchor = {
  id: string;
  /** Match pickup */
  pickupIn: (p: LatLng) => boolean;
  destIn: (p: LatLng) => boolean;
  /** Published / observed average for UberX-class */
  uberxAvg: number;
  weight: number;
};

const CORRIDOR_ANCHORS: CorridorAnchor[] = [
  {
    id: "westchester_to_manhattan",
    pickupIn: (p) => inWestchester(p.lat, p.lng),
    destIn: (p) => inManhattanBelow96(p.lat, p.lng),
    // Uber published Scarsdale→Manhattan ~$70; WestchesterRide $45–75 normal
    uberxAvg: 70,
    weight: 0.48,
  },
  {
    id: "manhattan_to_westchester",
    pickupIn: (p) => inManhattanBelow96(p.lat, p.lng),
    destIn: (p) => inWestchester(p.lat, p.lng),
    // Uber published Manhattan→Scarsdale ~$117 (directional asymmetry)
    uberxAvg: 105,
    weight: 0.4,
  },
  {
    id: "manhattan_to_jfk",
    pickupIn: (p) => inManhattanBelow96(p.lat, p.lng),
    destIn: (p) => Math.hypot(p.lat - 40.6413, p.lng - (-73.7781)) < 0.045,
    uberxAvg: 68,
    weight: 0.4,
  },
  {
    id: "jfk_to_manhattan",
    pickupIn: (p) => Math.hypot(p.lat - 40.6413, p.lng - (-73.7781)) < 0.045,
    destIn: (p) => inManhattanBelow96(p.lat, p.lng),
    uberxAvg: 68,
    weight: 0.4,
  },
  {
    id: "manhattan_to_lga",
    pickupIn: (p) => inManhattanBelow96(p.lat, p.lng),
    destIn: (p) => Math.hypot(p.lat - 40.7769, p.lng - (-73.874)) < 0.04,
    uberxAvg: 42,
    weight: 0.35,
  },
  {
    id: "lga_to_manhattan",
    pickupIn: (p) => Math.hypot(p.lat - 40.7769, p.lng - (-73.874)) < 0.04,
    destIn: (p) => inManhattanBelow96(p.lat, p.lng),
    uberxAvg: 42,
    weight: 0.35,
  },
];

function findAnchor(
  pickup: LatLng,
  destination: LatLng,
): CorridorAnchor | null {
  return (
    CORRIDOR_ANCHORS.find(
      (a) => a.pickupIn(pickup) && a.destIn(destination),
    ) ?? null
  );
}

/** Product rate cards — NYC overrides use RideWise Sep 2026. */
export function productRates(
  marketId: string,
  product: FareProduct,
): RateParts {
  const city = getCityRate(marketId);
  switch (product) {
    case "uberx":
      return city.uber;
    case "lyft":
      return city.lyft;
    case "taxi":
      return city.taxi;
    case "comfort":
      return {
        base: 3.85,
        perMile: city.uber.perMile * (2.15 / 1.75),
        perMin: city.uber.perMin * (0.45 / 0.35),
        booking: city.uber.booking,
        minimum: 10.5,
      };
    case "uberxl":
      return {
        base: 3.85,
        perMile: city.uber.perMile * (2.85 / 1.75),
        perMin: city.uber.perMin * (0.5 / 0.35),
        booking: city.uber.booking,
        minimum: 12,
      };
    case "lyft_xl":
      return {
        base: 3.75,
        perMile: city.lyft.perMile * (2.75 / 1.69),
        perMin: city.lyft.perMin * (0.48 / 0.33),
        booking: city.lyft.booking,
        minimum: 11.5,
      };
    case "empower":
      // Typical ~12% under UberX rate card
      return {
        base: city.uber.base * 0.92,
        perMile: city.uber.perMile * 0.88,
        perMin: city.uber.perMin * 0.9,
        booking: Math.max(1.75, city.uber.booking * 0.75),
        minimum: (city.uber.minimum ?? 8) * 0.9,
      };
  }
}

/**
 * Uncertainty band: keep spreads tight. Live OSRM + published cards
 * are strong; residual risk is demand/tolls.
 * Cap at ±4% (8% total span). Typical ±2–2.5%.
 */
export function uncertaintyBand(input: {
  miles: number;
  isPeak: boolean;
  crossJurisdiction: boolean;
  hasAnchor: boolean;
  product: FareProduct;
}): number {
  let band = input.hasAnchor ? 0.018 : 0.022;
  if (input.miles > 12) band += 0.004;
  if (input.miles > 25) band += 0.004;
  if (input.crossJurisdiction) band += 0.004;
  if (input.isPeak) band += 0.006;
  if (input.product === "empower") band += 0.004;
  if (input.product === "taxi") band += 0.006;
  return Math.min(0.035, Math.round(band * 1000) / 1000);
}

export function fareBandDollars(
  center: number,
  band: number,
): { low: number; high: number } {
  const low = Math.round(center * (1 - band) * 100) / 100;
  const high = Math.round(center * (1 + band) * 100) / 100;
  return { low, high };
}

/** Snap estimate centers to nearest $0.25 for stable, app-like display. */
export function snapFareCenter(dollars: number): number {
  return Math.round(dollars * 4) / 4;
}

const BLACK_CAR_FUND = 0.025;
/** NYC combined state/city sales tax on taxable FHV fare (metered portion). */
const NY_SALES_TAX = 0.08875;

export function computeProductFare(input: {
  product: FareProduct;
  provider: "uber" | "lyft" | "empower" | "curb";
  pickup: LatLng;
  destination: LatLng;
  miles: number;
  osrmMinutes: number;
  /** OSRM GeoJSON coordinates [lng,lat] for toll detection */
  routeCoordinates?: [number, number][];
  now?: Date;
}): ComputedFare {
  const now = input.now ?? new Date();
  const market = nearestCity(input.pickup.lat, input.pickup.lng);
  const traffic = trafficDurationFactor(now);
  const demand = mildDemand(now);
  const ctx = trafficContextFactor(input.miles, input.osrmMinutes);
  const trafficMinutes =
    input.osrmMinutes * traffic.factor * ctx;
  const fees = buildNyFeeStack(input.pickup, input.destination, input.provider);
  const rates = productRates(market.id, input.product);
  const tolls = estimateRouteTolls(input.routeCoordinates);

  if (fees.nycJfkFlatTaxi != null && input.product === "taxi") {
    const center = fees.nycJfkFlatTaxi;
    return {
      center,
      low: center,
      high: center,
      band: 0,
      rateCardDollars: center,
      feesDollars: 0,
      trafficMinutes,
      demandCenter: 1,
      demandLabel: "flat_fare",
      marketId: market.id,
      marketName: market.city.name,
      anchorId: null,
      anchorWeight: 0,
      feeBreakdown: fees.breakdown,
    };
  }

  const metered = computeFareDollars(
    rates,
    input.miles,
    trafficMinutes,
    demand.center,
  );
  const appliesBcf =
    input.provider === "uber" ||
    input.provider === "lyft" ||
    input.provider === "empower";
  const bcf =
    appliesBcf &&
    (market.id === "new-york" ||
      inNYC(input.pickup.lat, input.pickup.lng) ||
      inNYC(input.destination.lat, input.destination.lng))
      ? metered * BLACK_CAR_FUND
      : 0;
  const tnc =
    appliesBcf &&
    !inNYC(input.pickup.lat, input.pickup.lng) &&
    inNYC(input.destination.lat, input.destination.lng)
      ? metered * 0.02
      : 0;
  // Sales tax on metered fare (not on congestion flat fees / tips)
  const salesTax =
    appliesBcf && market.id === "new-york" ? metered * NY_SALES_TAX : 0;

  const feeBreakdown: Record<string, number> = {
    ...fees.breakdown,
    ...(bcf ? { black_car_fund: Math.round(bcf * 100) / 100 } : {}),
    ...(tnc ? { tnc_assessment: Math.round(tnc * 100) / 100 } : {}),
    ...(salesTax ? { ny_sales_tax: Math.round(salesTax * 100) / 100 } : {}),
  };
  for (const item of tolls.items) {
    feeBreakdown[`toll_${item.id}`] = item.amount;
  }

  const feesDollars =
    fees.addOnDollars + bcf + tnc + salesTax + tolls.amount;
  let rateCardTotal = metered + feesDollars;

  if (
    inNYC(input.pickup.lat, input.pickup.lng) &&
    inWestchester(input.destination.lat, input.destination.lng)
  ) {
    rateCardTotal *= 1.18;
    feeBreakdown.out_of_town_factor = 1.18;
  }

  const anchor = findAnchor(input.pickup, input.destination);
  let center = rateCardTotal;
  let anchorWeight = 0;
  const anchorable =
    input.product === "uberx" ||
    input.product === "lyft" ||
    input.product === "empower" ||
    input.product === "comfort";
  if (anchor && anchorable) {
    const uberRates = productRates(market.id, "uberx");
    const uberMetered = computeFareDollars(
      uberRates,
      input.miles,
      trafficMinutes,
      demand.center,
    );
    const scale =
      input.product === "uberx"
        ? 1
        : input.product === "lyft"
          ? metered / Math.max(uberMetered, 1)
          : input.product === "empower"
            ? 0.9
            : 1.18; // comfort premium vs UberX all-in
    const anchorFare = anchor.uberxAvg * scale;
    anchorWeight =
      input.product === "comfort" ? anchor.weight * 0.5 : anchor.weight;
    center = rateCardTotal * (1 - anchorWeight) + anchorFare * anchorWeight;
  }

  const isPeak =
    demand.label === "morning" ||
    demand.label === "evening" ||
    demand.label === "weekend_night";
  const band = uncertaintyBand({
    miles: input.miles,
    isPeak,
    crossJurisdiction: fees.crossJurisdiction,
    hasAnchor: Boolean(anchor) && anchorWeight > 0,
    product: input.product,
  });
  center = snapFareCenter(center);
  const { low, high } = fareBandDollars(center, band);

  return {
    center: Math.round(center * 100) / 100,
    low,
    high,
    band,
    rateCardDollars: Math.round(rateCardTotal * 100) / 100,
    feesDollars: Math.round(feesDollars * 100) / 100,
    trafficMinutes,
    demandCenter: demand.center,
    demandLabel: `${demand.label}+${traffic.label}+ctx${ctx.toFixed(2)}`,
    marketId: market.id,
    marketName: market.city.name,
    anchorId: anchorWeight > 0 ? (anchor?.id ?? null) : null,
    anchorWeight,
    feeBreakdown,
  };
}
