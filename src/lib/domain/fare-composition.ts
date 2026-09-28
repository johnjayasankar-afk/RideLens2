/**
 * What the fare is made of, in three parts that add up.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ "How we got this number" already exists and lists nineteen rows. That    │
 * │ answers an auditor. It does not answer the question a rider actually     │
 * │ asks, which is "how much of this is the ride and how much is everything  │
 * │ else" — and that one has a shape, so it should be drawn.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── The one rule ───────────────────────────────────────────────────────────
 *
 * The slices sum to the centre, exactly. A composition that nearly adds up is
 * worse than none: a reader who checks it finds a discrepancy and no reason
 * for it. The last slice is therefore defined as the residual rather than
 * computed independently, and `reconciles()` proves it in the tests.
 *
 * ── What it decomposes, and what it refuses to ─────────────────────────────
 *
 * The *centre*, not the band. The engine produces a centre and then widens it;
 * the centre is a real intermediate quantity, not a midpoint anybody averaged
 * into existence. The band travels with it so nothing here can be read as a
 * price, and `composeFare` returns null for any quote whose source handed over
 * a number without the arithmetic behind it — a partner's fare has no parts.
 *
 * The marketplace multiplier is deliberately *not* a slice. It multiplies the
 * metered portion inside the engine, and the split between "fare" and "surge"
 * would need the pre-multiplier rate fare, which no source publishes. Stating
 * it as a factor beside the bar is true; drawing it as a wedge would not be.
 */

import type { NormalizedQuote } from "./types";

export interface CompositionItem {
  label: string;
  dollars: number;
}

export interface CompositionSlice {
  id: "metered" | "fees" | "calibration";
  label: string;
  /** Dollars. `calibration` is signed and may be negative. */
  dollars: number;
  /** One line under the label, when the label alone would not be checkable. */
  detail: string;
  /** Named lines inside this slice, largest first. Empty when there are none. */
  items: CompositionItem[];
}

export interface FareComposition {
  /**
   * The modeled centre the band was drawn around.
   *
   * Not an average of the range on the card — the engine computes this first
   * and widens it afterwards. Printed with the band, never alone.
   */
  centerDollars: number;
  lowDollars: number;
  highDollars: number;
  /** Non-zero slices, in reading order. */
  slices: CompositionSlice[];
  /**
   * Half the band as a share of the centre. The engine's own uncertainty,
   * which is the only confidence figure here that means anything.
   */
  bandShare: number;
  /** The simulated marketplace tick, when it moved the fare at all. */
  multiplier: number | null;
  /** How much of the centre came from corridor averages rather than the card. */
  anchorWeight: number;
}

/**
 * Fee keys that are not additions to the fare.
 *
 * `nyc_jfk_flat` *is* the rate card on a flat-fare trip, and the TLC driver
 * minimum is a floor the metered fare was raised to meet — both are already
 * inside the subtotal. Listing either as an add-on would double it, which is
 * the specific bug that made a $70 cab render as $140 in the provenance sheet
 * before that code learned the same lesson.
 */
const NOT_AN_ADD_ON = new Set(["nyc_jfk_flat", "tlc_driver_minimum"]);

/** Keys whose value is a multiplier. A bare 1.18 in a list of dollars reads as $1.18. */
function isFactorKey(key: string): boolean {
  return key.endsWith("_factor") || key === "directional_asymmetry";
}

const FEE_ITEM_LABELS: Record<string, string> = {
  nys_congestion_below_96: "NYS congestion surcharge",
  nys_congestion_taxi: "NYS congestion surcharge",
  mta_congestion_below_60: "MTA congestion relief",
  mta_congestion_taxi: "MTA congestion relief",
  mta_state_surcharge: "MTA state surcharge",
  non_nyc_crz_fund: "CRZ fund",
  taxi_improvement: "Taxi improvement surcharge",
  black_car_fund: "Black Car Fund",
  tnc_assessment: "TNC assessment",
  ny_sales_tax: "NY sales tax",
  port_authority: "Port Authority fee",
  marketplace_rules: "Marketplace rules",
  marketplace_additive: "Marketplace rules",
};

const TOLL_NAMES: Record<string, string> = {
  gw_bridge: "George Washington Bridge",
  henry_hudson: "Henry Hudson Bridge",
  holland: "Holland Tunnel",
  hugh_carey: "Hugh L. Carey Tunnel",
  lincoln: "Lincoln Tunnel",
  queens_midtown: "Queens–Midtown Tunnel",
  queensboro: "Queensboro Bridge",
  rfk: "RFK Bridge",
  throgs_neck: "Throgs Neck Bridge",
  verrazzano: "Verrazzano-Narrows Bridge",
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Whether the fee stack is already inside the rate-card subtotal.
 *
 * The engine has two paths and they mean different things by
 * `rateCardDollars`: the metered path stores metered + fees, the TLC flat-fare
 * path stores the bare flat fare with the stack added afterwards. Getting this
 * backwards would not fail to add up — both readings reconcile — it would
 * quietly show a $70 flat fare as $56 of ride and $14 of fees.
 *
 * The engine now says which it is. The fallback is for sessions priced before
 * it did, and reads the same structural signal the provenance sheet uses: a
 * fee whose value *is* the subtotal is not an addition to it.
 */
function feesAreInsideSubtotal(m: Record<string, unknown>, rateCard: number): boolean {
  const stated = m.feesInsideRateCard;
  if (typeof stated === "boolean") return stated;
  const fees = (m.feeBreakdown ?? {}) as Record<string, unknown>;
  const flat = num(fees.nyc_jfk_flat);
  return !(flat !== null && Math.abs(flat - rateCard) < 0.005);
}

/**
 * Break a modeled fare into parts, or return null if it has none.
 *
 * Null is the right answer for a partner quote: the provider sent a price and
 * no arithmetic, and a breakdown invented for it would be fiction with a chart
 * around it.
 */
export function composeFare(quote: NormalizedQuote): FareComposition | null {
  const m = quote.metadata ?? {};
  const center = num(m.centerFare);
  const rateCard = num(m.rateCardDollars);
  const fees = num(m.feesDollars);
  if (center === null || rateCard === null || fees === null) return null;
  if (center <= 0) return null;

  /*
   * Every figure is rounded to the cent *before* anything is derived from it,
   * and the last one is then defined as what is left over. Rounding at the
   * end instead let three slices sum to $79.01 under a $78.90 centre — a
   * tenth of a cent of float error per slice, and a bar that visibly lied.
   */
  const centerR = round2(center);
  const feesR = round2(fees);
  /*
   * The fee total can come out negative.
   *
   * `marketplace.additiveDollars` is signed — the simulated marketplace
   * discounts as well as adds — and the fuzzer duly produced a fare whose
   * whole fee stack was −$0.11. "Taxes and surcharges: −$0.11" is nonsense on
   * its face, and a negative wedge in a stacked bar is worse. A fee total
   * that is not a positive amount belongs to the ride's own figure, where it
   * already effectively is.
   */
  const feesShown = feesR > 0.005 ? feesR : 0;
  const meteredR = round2(
    (feesAreInsideSubtotal(m, rateCard) ? rateCard - fees : rateCard) + (feesR - feesShown),
  );
  const calibration = round2(centerR - meteredR - feesShown);

  const breakdown = (m.feeBreakdown ?? {}) as Record<string, unknown>;
  const items: CompositionItem[] = [];
  let named = 0;
  /* Nothing to itemise when there is no fee slice to itemise it under. */
  for (const [key, raw] of feesShown > 0 ? Object.entries(breakdown) : []) {
    if (NOT_AN_ADD_ON.has(key) || isFactorKey(key)) continue;
    const value = num(raw);
    if (value === null || value === 0) continue;
    const label = key.startsWith("toll_")
      ? `Toll — ${TOLL_NAMES[key.slice(5)] ?? key.slice(5).replace(/[-_]/g, " ")}`
      : (FEE_ITEM_LABELS[key] ?? key.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase()));
    items.push({ label, dollars: round2(value) });
    named += value;
  }
  items.sort((a, b) => b.dollars - a.dollars);

  /*
   * What the itemisation could not name.
   *
   * The engine's fee total is authoritative and the breakdown is a courtesy;
   * if a fee is ever added to one and not the other, this line makes the gap
   * visible instead of letting the items quietly disagree with their own sum.
   */
  const unnamed = round2(feesShown - named);
  if (Math.abs(unnamed) >= 0.01) {
    items.push({ label: "Other fees and surcharges", dollars: unnamed });
  }

  /*
   * Below half a dollar the residual is `snapFareCenter` rounding, not a
   * finding — but it still has to go somewhere, or the bar stops adding up.
   * It joins the ride, whose figure it came from. (The first version dropped
   * it, and the fuzzer immediately found a fare where three slices summed to
   * $79.00 under a $78.90 centre.)
   */
  const worthNaming = Math.abs(calibration) >= 0.5;
  const ride = worthNaming ? meteredR : round2(centerR - feesShown);

  const slices: CompositionSlice[] = [];
  if (ride > 0.005) {
    slices.push({
      id: "metered",
      label: "The ride itself",
      dollars: ride,
      detail: "Base, distance and time under the published tariff, at the current market tick.",
      items: [],
    });
  }
  if (feesShown > 0) {
    slices.push({
      id: "fees",
      label: "Taxes, tolls and surcharges",
      dollars: feesShown,
      detail: "Statutory and route charges. None of this reaches the driver.",
      items,
    });
  }
  if (worthNaming || slices.length === 0) {
    const anchorWeight = num(m.anchorWeight) ?? 0;
    slices.push({
      id: "calibration",
      label: calibration >= 0 ? "Corridor calibration" : "Corridor calibration (down)",
      dollars: worthNaming ? calibration : round2(centerR - ride - feesShown),
      detail:
        anchorWeight > 0
          ? `What published corridor averages and the direction of travel move the card price by. ${Math.round(anchorWeight * 100)}% of the centre comes from corridor data.`
          : "What the direction of travel moves the card price by.",
      items: [],
    });
  }

  const band = num(m.band) ?? 0;
  return {
    centerDollars: centerR,
    lowDollars: quote.priceMinMinor / 100,
    highDollars: quote.priceMaxMinor / 100,
    slices,
    bandShare: band,
    multiplier: num(m.demandCenter),
    anchorWeight: num(m.anchorWeight) ?? 0,
  };
}

/** Whether the slices reach the centre. The tests hold this to the cent. */
export function reconciles(c: FareComposition): boolean {
  const sum = c.slices.reduce((t, s) => t + s.dollars, 0);
  return Math.abs(sum - c.centerDollars) < 0.005;
}
