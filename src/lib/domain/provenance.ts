/**
 * Where a number on screen came from, in three words and then in full.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE GAP THIS CLOSES                                                      │
 * │                                                                          │
 * │ The hero reads "Live roads. Real rate cards. A marketplace that moves    │
 * │ with the clock." Every word is true and a reader still comes away        │
 * │ thinking they were shown a live Uber price. They were shown arithmetic:  │
 * │ an OSRM route, a published rate card, a fee stack, and a deterministic   │
 * │ simulation of marketplace behaviour.                                     │
 * │                                                                          │
 * │ The decomposition already exists — ComputedFare carries feeBreakdown and │
 * │ marketplaceFactors, and nothing has ever rendered them. This module      │
 * │ turns that into a claim a reader can check.                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Two things are deliberately separate here: what *kind* of number this is
 * (the chip) and *how it was built* (the rows). A partner upfront fare and a
 * modeled estimate can print the same digits; only the first is a price
 * anybody has promised.
 */
import type { NormalizedQuote } from "./types";

export type ProvenanceKind =
  "MODELED_ESTIMATE" | "MARKET_RANGE" | "PARTNER_UPFRONT" | "PARTNER_ESTIMATE" | "FIXTURE";

export interface Provenance {
  kind: ProvenanceKind;
  /** Three words, for the chip. */
  label: string;
  /** One sentence, for the sheet's opening line. */
  summary: string;
  /**
   * True when no provider has seen this number. The UI leans on this to decide
   * whether "confirm in the app" is advice or a requirement.
   */
  modeled: boolean;
}

const PROVENANCE: Record<ProvenanceKind, Omit<Provenance, "kind">> = {
  MODELED_ESTIMATE: {
    label: "Modeled estimate",
    summary:
      "Computed here from a live route, a published rate card and a simulated marketplace. No provider has quoted this trip.",
    modeled: true,
  },
  MARKET_RANGE: {
    label: "Market range",
    summary:
      "Percentiles from Obi's licensed market feed — what this trip has recently cost across the market, not a quote addressed to you.",
    modeled: false,
  },
  PARTNER_UPFRONT: {
    label: "Partner upfront",
    summary: "The provider's own API states this fare is locked before the ride.",
    modeled: false,
  },
  PARTNER_ESTIMATE: {
    label: "Partner estimate",
    summary: "The provider's own API supplied this figure and may change it before pickup.",
    modeled: false,
  },
  FIXTURE: {
    label: "Test fixture",
    summary: "A recorded fixture. This never appears in production.",
    modeled: true,
  },
};

export function provenanceOf(
  quote: Pick<NormalizedQuote, "sourceMethod" | "priceType">,
): Provenance {
  const kind = kindOf(quote);
  return { kind, ...PROVENANCE[kind] };
}

function kindOf(quote: Pick<NormalizedQuote, "sourceMethod" | "priceType">): ProvenanceKind {
  switch (quote.sourceMethod) {
    case "public_rate_card":
      return "MODELED_ESTIMATE";
    case "licensed_aggregation":
      return "MARKET_RANGE";
    case "fixture":
      return "FIXTURE";
    case "partner_api":
    case "authorized_direct":
      // Only the price type distinguishes these, and the distinction is the
      // whole point: one is a promise, the other is a forecast.
      return quote.priceType === "UPFRONT_QUOTE" ? "PARTNER_UPFRONT" : "PARTNER_ESTIMATE";
    default:
      return "MODELED_ESTIMATE";
  }
}

/* -------------------------------------------------------------------------- */
/* The decomposition                                                          */
/* -------------------------------------------------------------------------- */

export type RowKind = "money" | "factor" | "note" | "total";

export interface ProvenanceRow {
  label: string;
  /** Dollars for `money`, a multiplier for `factor`, free text for `note`. */
  value: number | string;
  kind: RowKind;
  /** Where this line comes from, when it is not obvious from the label. */
  detail?: string;
}

/**
 * Fee keys the engine actually emits, in the order a reader wants them.
 *
 * Taken from fare-engine.ts rather than guessed — a label map that does not
 * match the keys renders an empty "breakdown", which would look like candour
 * and show nothing.
 */
const FEE_LABELS: Array<[string, string, string?]> = [
  ["nyc_jfk_flat", "JFK flat fare", "TLC-set flat fare, Manhattan ↔ JFK"],
  [
    "nys_congestion_below_96",
    "NYS congestion surcharge",
    "$2.75 on for-hire trips touching Manhattan below 96th St",
  ],
  ["nys_congestion_taxi", "NYS congestion surcharge (taxi)", "Taxi rate, same zone"],
  [
    "mta_congestion_below_60",
    "MTA congestion relief",
    "Manhattan below 60th St, the CRZ tolling zone",
  ],
  ["mta_congestion_taxi", "MTA congestion relief (taxi)", "Taxi rate, same zone"],
  ["mta_state_surcharge", "MTA state surcharge"],
  ["non_nyc_crz_fund", "CRZ fund (outside NYC)"],
  ["taxi_improvement", "Taxi improvement surcharge"],
  ["black_car_fund", "Black Car Fund", "NY levy on for-hire trips"],
  ["tnc_assessment", "TNC assessment"],
  ["ny_sales_tax", "NY sales tax"],
  ["port_authority", "Port Authority fee", "Airport access, PANYNJ"],
  ["out_of_town_factor", "Out-of-town factor"],
  ["directional_asymmetry", "Directional adjustment"],
  ["marketplace_rules", "Marketplace rules", "Additive component of the simulated marketplace"],
  /* The flat-fare path names the same quantity differently. */
  ["marketplace_additive", "Marketplace rules", "Additive component of the simulated marketplace"],
];

/** Crossings tolls.ts can name, so `toll_<id>` reads as a place. */
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

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Every line that produced this fare, from the metadata the source already
 * publishes.
 *
 * Returns [] for a quote whose source did not decompose itself — a partner
 * API hands over a number and no arithmetic, and inventing a breakdown for it
 * would be worse than showing none.
 */
export function provenanceRows(quote: NormalizedQuote): ProvenanceRow[] {
  const m = quote.metadata ?? {};
  const rows: ProvenanceRow[] = [];

  const rateCard = num(m.rateCardDollars);
  const fees = (m.feeBreakdown ?? {}) as Record<string, unknown>;

  /*
   * A fee equal to the subtotal is not an addition to it — it *is* it.
   *
   * On a Manhattan↔JFK trip the engine sets rateCardDollars to the TLC flat
   * fare and also records nyc_jfk_flat at the same value. Listing both as
   * money made the sheet read as $140 for a $70 fare, which is worse than
   * showing no breakdown at all: a reader who checks the arithmetic gets a
   * wrong answer and no warning. It becomes the subtotal's provenance instead.
   */
  const derivation =
    rateCard === null
      ? null
      : FEE_LABELS.find(([key]) => num(fees[key]) !== null && num(fees[key]) === rateCard);

  if (rateCard !== null) {
    const city = str(m.city);
    const parts = [city ? `${city} published tariff` : null, derivation?.[2] ?? derivation?.[1]];
    rows.push({
      label: "Rate card subtotal",
      value: rateCard,
      kind: "money",
      detail: parts.filter(Boolean).join(" — ") || undefined,
    });
  }

  const seen = new Set<string>(derivation ? [derivation[0]] : []);
  for (const [key, label, detail] of FEE_LABELS) {
    if (seen.has(key)) continue;
    const value = num(fees[key]);
    if (value === null || value === 0) continue;
    seen.add(key);
    rows.push({
      label,
      value,
      kind: key.endsWith("_factor") || key === "directional_asymmetry" ? "factor" : "money",
      detail,
    });
  }

  /*
   * Everything the map did not already name — tolls are per-crossing, and a
   * fee added later would otherwise vanish from a breakdown that claims to be
   * complete.
   */
  for (const [key, raw] of Object.entries(fees)) {
    if (seen.has(key)) continue;
    const value = num(raw);
    if (value === null || value === 0) continue;
    if (key.startsWith("toll_")) {
      const id = key.slice(5);
      rows.push({
        label: `Toll — ${TOLL_NAMES[id] ?? id.replace(/[-_]/g, " ")}`,
        value,
        kind: "money",
      });
      continue;
    }
    rows.push({
      label: key.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase()),
      value,
      kind: key.endsWith("_factor") ? "factor" : "money",
    });
  }

  /*
   * What the fee stack does not include. Named rather than merely implied by
   * a wide band: a rider can act on "airport levies are not included" and
   * cannot act on "low confidence".
   */
  const feeNote = str(m.feeModelNote);
  if (feeNote) {
    rows.push({
      label: "Regulatory fees",
      value: "Not modeled here",
      kind: "note",
      detail: feeNote,
    });
  }

  const traffic = num(m.trafficMinutes);
  if (traffic !== null) {
    rows.push({
      label: "Traffic-adjusted minutes",
      value: `${Math.round(traffic)} min`,
      kind: "note",
      detail: "Free-flow OSRM duration scaled by a time-of-day factor — modeled, not measured",
    });
  }

  /*
   * One multiplier, and the signals that fed it named underneath.
   *
   * marketplaceFactors carries the composite under `multiplier` alongside its
   * own inputs — tod_lift, zone_heat, calendar_lift, elasticity, raw_demand.
   * Rendering those as rows printed "×0.28" beside the fare, which reads as a
   * 72% discount. They are evidence, not arithmetic, so they go in the detail
   * line and only the multiplier is shown as one.
   */
  const factors = (m.marketplaceFactors ?? {}) as Record<string, unknown>;
  const multiplier = num(factors.multiplier);
  if (multiplier !== null && multiplier !== 1) {
    const signals = Object.entries(factors)
      .filter(([k, v]) => k !== "multiplier" && num(v) !== null)
      .map(([k, v]) => `${k.replace(/[-_]/g, " ")} ${num(v)!.toFixed(2)}`);
    rows.push({
      label: "Marketplace multiplier",
      value: multiplier,
      kind: "factor",
      detail: signals.length
        ? `Simulated, not observed. Signals: ${signals.join(", ")}`
        : "Simulated, not observed.",
    });
  }

  const weatherLift = num(m.weatherSurgeLift);
  if (weatherLift !== null && weatherLift !== 1 && weatherLift !== 0) {
    rows.push({
      label: "Weather lift",
      value: weatherLift,
      kind: "factor",
      detail: str(m.weather) ? `Open-Meteo: ${m.weather}` : "Live precipitation signal",
    });
  }

  /*
   * The figure on the card, so the arithmetic above has something to
   * reconcile against. Without it a reader can add the lines up and have no
   * way to tell whether they arrived at the right place.
   */
  if (rows.length > 0) {
    /* Before the total, which must stay last — the sheet's whole claim is
       that the lines above it reconcile to the figure on the card. */
    rows.push(...waitRows(quote));

    const lo = quote.priceMinMinor / 100;
    const hi = quote.priceMaxMinor / 100;
    rows.push({
      label: "Shown on the card",
      value: lo === hi ? `$${lo.toFixed(2)}` : `$${lo.toFixed(2)} – $${hi.toFixed(2)}`,
      kind: "total",
      detail: "Subtotal and fees, moved by the multipliers above, then widened into a band.",
    });
  }

  return rows;
}

/**
 * How the pickup wait was arrived at.
 *
 * The sheet decomposed the fare to the last cent and said nothing at all
 * about the wait, so "2 to 3 min" sat on the card looking exactly like a
 * number fetched from a provider. It is a model — of supply density at the
 * pickup, the provider's fleet, the vehicle class and the hour — and the one
 * place a rider goes to ask where a number came from should say so.
 *
 * Nothing here claims a source it does not have. `MODEL_PARAMS.wait` records
 * that these are priors fitted to nothing, and this says the same in a
 * sentence a rider can read.
 */
export function waitRows(quote: NormalizedQuote): ProvenanceRow[] {
  const m = quote.metadata ?? {};
  const density = typeof m.waitDensity === "string" ? m.waitDensity : null;
  /*
   * Only our own model writes waitDensity. A partner quote carries a real
   * ETA from the provider, and telling a rider that one is "modeled" would
   * be a fresh lie in the opposite direction.
   */
  if (!density) return [];

  const low = num(m.waitLowSeconds);
  const high = num(m.waitHighSeconds);
  const mid = quote.pickupEtaSeconds;
  if (low === null && high === null && mid == null) return [];
  const confidence = typeof m.waitConfidence === "string" ? m.waitConfidence : null;

  const asMin = (sec: number) => Math.max(1, Math.round(sec / 60));
  const band =
    low !== null && high !== null
      ? asMin(low) === asMin(high)
        ? `${asMin(low)} min`
        : `${asMin(low)} to ${asMin(high)} min`
      : mid != null
        ? `${asMin(mid)} min`
        : "—";

  const rows: ProvenanceRow[] = [
    {
      label: "Pickup wait",
      value: band,
      kind: "note",
      detail: DENSITY_DETAIL[density] ?? "Modeled from supply near the pickup.",
    },
  ];

  if (confidence === "low") {
    rows.push({
      label: "Wait confidence",
      value: "Low",
      kind: "note",
      detail: "Few cars are modeled around this pickup, so the wait could be well out.",
    });
  }

  rows.push({
    label: "Not a live ETA",
    value: "Modeled",
    kind: "note",
    detail:
      "No provider was asked how far away a car is. This is a model of typical waits, " +
      "and it has never been checked against a real one — see docs/CALIBRATION.md.",
  });

  return rows;
}

/** What the density band actually means, rather than its internal name. */
const DENSITY_DETAIL: Record<string, string> = {
  core: "Dense city centre, where cars are usually close by.",
  inner: "Inner city, a little thinner than the centre.",
  outer: "Outer metro, where cars are spread further apart.",
  suburb: "Suburban, with far fewer cars circulating.",
  airport: "Airport, where cars queue rather than circulate.",
  sparse: "Little modeled supply here at all.",
};

/**
 * What the band means, said plainly.
 *
 * A range and an exact figure look alike at a glance, and the difference is
 * the most important thing on the card.
 */
export function bandNote(quote: NormalizedQuote): string {
  if (quote.priceMinMinor === quote.priceMaxMinor) {
    return provenanceOf(quote).modeled
      ? "A single modeled figure, not a locked fare."
      : "A single figure from the provider.";
  }
  return "A range. The fare could land anywhere inside it, and no midpoint is shown because none was quoted.";
}
