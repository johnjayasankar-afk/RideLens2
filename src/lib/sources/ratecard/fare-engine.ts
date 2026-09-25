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
import { estimateRouteTolls, trafficContextFactor } from "@/lib/sources/ratecard/tolls";
import { computeMarketplaceState } from "@/lib/sources/ratecard/marketplace-dynamics";
import { directionalAsymmetry } from "@/lib/sources/ratecard/hotspots";

export type LatLng = { lat: number; lng: number };

export type FareProduct = "uberx" | "comfort" | "uberxl" | "lyft" | "lyft_xl" | "taxi" | "empower";

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
  /** Marketplace tick + factor breakdown (realtime simulation). */
  marketplaceTick: number;
  secondsToNextTick: number;
  marketplaceFactors: Record<string, number>;
  waitBoost: number;
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
 * @deprecated Prefer computeMarketplaceState — kept for older tests/callers.
 * Coarse TOD residual only; realtime path uses marketplace-dynamics.
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

  const nearJfk = (p: LatLng) => Math.hypot(p.lat - 40.6413, p.lng - -73.7781) < 0.04;
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

  if (touchesBelow96 && provider !== "taxi" && provider !== "curb" && provider !== "empower") {
    breakdown.nys_congestion_below_96 = 2.75;
    addOn += 2.75;
  } else if (touchesBelow96 && (provider === "taxi" || provider === "curb")) {
    breakdown.nys_congestion_taxi = 2.5;
    addOn += 2.5;
  }
  // Empower: Obi Q1 2026 receipt averages ~30% under Uber/Lyft; public reporting
  // notes many Empower quotes omit TLC/MTA congestion pass-through. Model a
  // partial/zero congestion stack so displayed prices track the app, not TLC rules.

  if (touchesBelow60 && provider !== "taxi" && provider !== "curb" && provider !== "empower") {
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
    provider !== "curb" &&
    provider !== "empower"
  ) {
    breakdown.non_nyc_crz_fund = 2.0;
    addOn += 2.0;
  }

  // Taxi improvement + MTA state surcharges (TLC)
  if (provider === "taxi" || provider === "curb") {
    breakdown.taxi_improvement = 0.3;
    breakdown.mta_state_surcharge = 0.5;
    addOn += 0.8;
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
    uberxAvg: 70,
    weight: 0.48,
  },
  {
    id: "manhattan_to_westchester",
    pickupIn: (p) => inManhattanBelow96(p.lat, p.lng),
    destIn: (p) => inWestchester(p.lat, p.lng),
    uberxAvg: 105,
    weight: 0.4,
  },
  {
    id: "manhattan_to_jfk",
    pickupIn: (p) => inManhattanBelow96(p.lat, p.lng),
    destIn: (p) => Math.hypot(p.lat - 40.6413, p.lng - -73.7781) < 0.045,
    // RideWise / FAQ mid: $55–85 → center ~68–70
    uberxAvg: 68,
    weight: 0.42,
  },
  {
    id: "jfk_to_manhattan",
    pickupIn: (p) => Math.hypot(p.lat - 40.6413, p.lng - -73.7781) < 0.045,
    destIn: (p) => inManhattanBelow96(p.lat, p.lng),
    uberxAvg: 62,
    weight: 0.42,
  },
  {
    id: "manhattan_to_lga",
    pickupIn: (p) => inManhattanBelow96(p.lat, p.lng),
    destIn: (p) => Math.hypot(p.lat - 40.7769, p.lng - -73.874) < 0.04,
    // RideWise LGA→downtown $32–47; Midtown↔LGA ~$38–45
    uberxAvg: 40,
    weight: 0.38,
  },
  {
    id: "lga_to_manhattan",
    pickupIn: (p) => Math.hypot(p.lat - 40.7769, p.lng - -73.874) < 0.04,
    destIn: (p) => inManhattanBelow96(p.lat, p.lng),
    uberxAvg: 38,
    weight: 0.38,
  },
  {
    id: "manhattan_to_ewr",
    pickupIn: (p) => inManhattanBelow96(p.lat, p.lng),
    destIn: (p) => Math.hypot(p.lat - 40.6895, p.lng - -74.1745) < 0.05,
    // RideWise EWR→downtown $34–51 + tolls → ~$48 mid
    uberxAvg: 48,
    weight: 0.36,
  },
  {
    id: "ewr_to_manhattan",
    pickupIn: (p) => Math.hypot(p.lat - 40.6895, p.lng - -74.1745) < 0.05,
    destIn: (p) => inManhattanBelow96(p.lat, p.lng),
    uberxAvg: 46,
    weight: 0.36,
  },
  {
    id: "midtown_to_williamsburg",
    pickupIn: (p) => p.lat > 40.748 && p.lat < 40.762 && p.lng > -74.0 && p.lng < -73.97,
    destIn: (p) => p.lat > 40.71 && p.lat < 40.73 && p.lng > -73.97 && p.lng < -73.95,
    // RideWise Bryant Park → Williamsburg ~$22–35 off-peak / $58 peak crawl
    uberxAvg: 28,
    weight: 0.28,
  },
];

function findAnchor(pickup: LatLng, destination: LatLng): CorridorAnchor | null {
  return CORRIDOR_ANCHORS.find((a) => a.pickupIn(pickup) && a.destIn(destination)) ?? null;
}

/** Product rate cards — NYC overrides use RideWise Sep 2026. */
export function productRates(marketId: string, product: FareProduct): RateParts {
  const city = getCityRate(marketId);
  switch (product) {
    case "uberx":
      return city.uber;
    case "lyft":
      return city.lyft;
    case "taxi":
      // TLC yellow cab (2026): $3.00 drop + $0.70 / 1/5 mi (= $3.50/mi)
      // + $0.70 / 60s in slow traffic. Booking here is unused (surcharges separate).
      return {
        base: 3.0,
        perMile: 3.5,
        perMin: 0.7,
        booking: 0,
        minimum: 3.0,
      };
    case "comfort":
      return {
        base: 3.85,
        perMile: 2.15,
        perMin: 0.45,
        booking: city.uber.booking,
        minimum: 10.5,
      };
    case "uberxl":
      return {
        base: 3.85,
        perMile: 2.85,
        perMin: 0.5,
        booking: city.uber.booking,
        minimum: 12,
      };
    case "lyft_xl":
      return {
        base: 3.75,
        perMile: 2.75,
        perMin: 0.48,
        booking: city.lyft.booking,
        minimum: 11.5,
      };
    case "empower":
      // Obi Q1 2026: Empower ~30% cheaper than Uber/Lyft on receipt averages.
      // Driver-set fares + subscription model → lower effective rate card.
      return {
        base: city.uber.base * 0.78,
        perMile: city.uber.perMile * 0.72,
        perMin: city.uber.perMin * 0.72,
        booking: Math.max(0.5, city.uber.booking * 0.35),
        minimum: (city.uber.minimum ?? 8) * 0.75,
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

export function fareBandDollars(center: number, band: number): { low: number; high: number } {
  const low = Math.round(center * (1 - band) * 100) / 100;
  const high = Math.round(center * (1 + band) * 100) / 100;
  return { low, high };
}

/** Snap estimate centers to nearest $0.05 so minute ticks visibly move. */
export function snapFareCenter(dollars: number): number {
  return Math.round(dollars * 20) / 20;
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
  /** Open-Meteo weather surge lift (1 = dry). */
  weatherSurgeLift?: number;
}): ComputedFare {
  const now = input.now ?? new Date();
  const market = nearestCity(input.pickup.lat, input.pickup.lng);
  const traffic = trafficDurationFactor(now);
  const marketplace = computeMarketplaceState({
    provider: input.provider,
    product: input.product,
    pickup: input.pickup,
    destination: input.destination,
    miles: input.miles,
    osrmMinutes: input.osrmMinutes,
    now,
    weatherSurgeLift: input.weatherSurgeLift,
  });
  const ctx = trafficContextFactor(input.miles, input.osrmMinutes);
  const trafficMinutes = input.osrmMinutes * traffic.factor * ctx * marketplace.trafficBoost;
  const fees = buildNyFeeStack(input.pickup, input.destination, input.provider);
  const rates = productRates(market.id, input.product);
  const tolls = estimateRouteTolls(input.routeCoordinates);

  if (fees.nycJfkFlatTaxi != null && input.product === "taxi") {
    // Flat fare still gets taxi peak/night additives when TLC applies them on top
    const center = snapFareCenter(fees.nycJfkFlatTaxi + marketplace.additiveDollars);
    return {
      center,
      low: center,
      high: Math.round((center + 1.5) * 100) / 100,
      band: 0.01,
      rateCardDollars: fees.nycJfkFlatTaxi,
      feesDollars: marketplace.additiveDollars,
      trafficMinutes,
      demandCenter: marketplace.multiplier,
      demandLabel: `flat_fare+${marketplace.label}`,
      marketId: market.id,
      marketName: market.city.name,
      anchorId: null,
      anchorWeight: 0,
      feeBreakdown: {
        ...fees.breakdown,
        marketplace_additive: marketplace.additiveDollars,
      },
      marketplaceTick: marketplace.tickEpoch,
      secondsToNextTick: marketplace.secondsToNextTick,
      marketplaceFactors: marketplace.factors,
      waitBoost: marketplace.waitBoost,
    };
  }

  const metered = computeFareDollars(rates, input.miles, trafficMinutes, marketplace.multiplier);
  const appliesBcf = input.provider === "uber" || input.provider === "lyft";
  // Empower: modeled without Black Car Fund / sales tax stack (app quotes often omit)
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
  const salesTax = appliesBcf && market.id === "new-york" ? metered * NY_SALES_TAX : 0;

  const feeBreakdown: Record<string, number> = {
    ...fees.breakdown,
    ...(bcf ? { black_car_fund: Math.round(bcf * 100) / 100 } : {}),
    ...(tnc ? { tnc_assessment: Math.round(tnc * 100) / 100 } : {}),
    ...(salesTax ? { ny_sales_tax: Math.round(salesTax * 100) / 100 } : {}),
  };
  if (marketplace.additiveDollars) {
    feeBreakdown.marketplace_rules = marketplace.additiveDollars;
  }
  for (const item of tolls.items) {
    feeBreakdown[`toll_${item.id}`] = item.amount;
  }

  const feesDollars =
    fees.addOnDollars + bcf + tnc + salesTax + tolls.amount + marketplace.additiveDollars;
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
      marketplace.multiplier,
    );
    const scale =
      input.product === "uberx"
        ? 1
        : input.product === "lyft"
          ? metered / Math.max(uberMetered, 1)
          : input.product === "empower"
            ? 0.72 // Obi ~30% under UberX-class
            : 1.18; // comfort premium vs UberX all-in
    // Scale published corridor averages with the same marketplace tick
    const anchorFare = anchor.uberxAvg * scale * marketplace.multiplier;
    anchorWeight = input.product === "comfort" ? anchor.weight * 0.5 : anchor.weight;
    // Slightly reduce anchor pull when marketplace is hot so live tick matters more
    const liveWeight = Math.min(
      0.62,
      anchorWeight * (1.15 - Math.min(0.25, marketplace.multiplier - 1)),
    );
    center = rateCardTotal * (1 - liveWeight) + anchorFare * liveWeight;
    anchorWeight = liveWeight;
  }

  // Outer-borough ↔ Manhattan directional asymmetry (RideWise ~18%)
  const dir = directionalAsymmetry(input.pickup, input.destination);
  if (dir !== 1) {
    center *= dir;
    feeBreakdown.directional_asymmetry = dir;
  }

  const isPeak = marketplace.multiplier >= 1.08;
  const band = uncertaintyBand({
    miles: input.miles,
    isPeak,
    crossJurisdiction: fees.crossJurisdiction,
    hasAnchor: Boolean(anchor) && anchorWeight > 0,
    product: input.product,
  });
  // Widen band slightly when marketplace is moving fast
  const liveBand = Math.min(0.04, band + Math.max(0, marketplace.multiplier - 1) * 0.04);
  center = snapFareCenter(center);
  const { low, high } = fareBandDollars(center, liveBand);

  return {
    center: Math.round(center * 100) / 100,
    low,
    high,
    band: liveBand,
    rateCardDollars: Math.round(rateCardTotal * 100) / 100,
    feesDollars: Math.round(feesDollars * 100) / 100,
    trafficMinutes,
    demandCenter: marketplace.multiplier,
    demandLabel: `${marketplace.label}+${traffic.label}+ctx${ctx.toFixed(2)}`,
    marketId: market.id,
    marketName: market.city.name,
    anchorId: anchorWeight > 0 ? (anchor?.id ?? null) : null,
    anchorWeight,
    feeBreakdown,
    marketplaceTick: marketplace.tickEpoch,
    secondsToNextTick: marketplace.secondsToNextTick,
    marketplaceFactors: marketplace.factors,
    waitBoost: marketplace.waitBoost,
  };
}
