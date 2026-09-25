/**
 * Which providers a rider can actually hail, per market.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE BUG THIS EXISTS FOR                                                  │
 * │                                                                          │
 * │ PublicRateCardQuoteSource emitted a `curb_taxi` and an `empower_standard`│
 * │ quote on every comparison, in all 49 modelled markets, with              │
 * │ providersSurfaced hardcoded to ["uber","lyft","curb","empower"]. Their    │
 * │ own notes give the game away: the Curb quote says "TLC meter +           │
 * │ peak/night surcharges; Manhattan↔JFK flat", and the Empower quote says   │
 * │ "Calibrated ~30% under UberX-class (Obi Q1 2026 NYC receipts)".          │
 * │                                                                          │
 * │ So a rider in Phoenix was shown a Curb fare computed from the New York   │
 * │ TLC meter, for a service they cannot hail in Phoenix.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── Three states, not two ──────────────────────────────────────────────────
 *
 * "Operates" and "does not operate" are not exhaustive. The third case —
 * nobody has checked — is the one that actually caused the bug, and collapsing
 * it into either of the others is how a guess becomes a claim.
 *
 *   OPERATES           confirmed present, with a source and a date
 *   DOES_NOT_OPERATE   confirmed absent, with a source and a date
 *   UNVERIFIED         nobody has checked  ← the default for every pair
 *
 * **Only OPERATES is surfaced.** UNVERIFIED and DOES_NOT_OPERATE are both
 * omitted from the comparison, but they are reported to the rider differently,
 * because "we checked and it isn't here" and "we haven't checked" are
 * different sentences — the same distinction PRODUCT_SPEC.md already draws
 * between "not connected" and "no cars".
 *
 * ── On the honesty of this table ───────────────────────────────────────────
 *
 * Every entry below carries the basis it rests on. Two of them are ordinary
 * background knowledge rather than a checked service-area page, and they say
 * so in `source`. Nothing here was inferred from the model, and no city list
 * was invented to make the table look complete: a pair with no entry stays
 * UNVERIFIED and is simply not shown.
 *
 * That has a deliberate consequence. Empower has no confirmed entry anywhere,
 * so it currently surfaces nowhere. That is the correct failure direction —
 * it was previously surfacing in 49 markets on the strength of nothing — and
 * it is fixed by verifying its service area, not by loosening this rule.
 *
 * Cross-check against `docs/DATA_SOURCE_MATRIX.md`, which records the separate
 * question of whether RideLens may legally *quote* a provider. Both must hold:
 * a provider needs a licence to be quoted and a presence to be hailed.
 */
import type { ProviderId } from "./types";

export type CoverageStatus = "OPERATES" | "DOES_NOT_OPERATE" | "UNVERIFIED";

export interface CoverageEntry {
  status: CoverageStatus;
  /**
   * What this rests on. A checked service-area page, a regulatory filing, or —
   * stated as such — ordinary background knowledge. Never the model.
   */
  source: string;
  /** ISO date the claim was last checked. Null when it never has been. */
  verifiedOn: string | null;
}

/** Markets a provider is confirmed to serve, keyed by market id. */
type ProviderCoverage = Partial<Record<string, CoverageEntry>>;

/**
 * Uber and Lyft run nationwide US networks and serve every market modelled
 * here. This is background knowledge, not a per-city check, and `source` says
 * so rather than implying a verification that did not happen.
 */
const NATIONWIDE: CoverageEntry = {
  status: "OPERATES",
  source:
    "Nationwide US network; background knowledge, not a per-market service-area check. Re-verify per market before relying on it commercially.",
  verifiedOn: null,
};

/**
 * Every market the rate card models. A provider is surfaced in one of these
 * only with an explicit OPERATES entry below.
 */
export const MODELLED_MARKETS = [
  "new-york",
  "los-angeles",
  "chicago",
  "houston",
  "phoenix",
  "philadelphia",
  "san-antonio",
  "san-diego",
  "dallas",
  "san-jose",
  "austin",
  "jacksonville",
  "san-francisco",
  "seattle",
  "denver",
  "washington-dc",
  "nashville",
  "boston",
  "las-vegas",
  "portland",
  "miami",
  "atlanta",
  "minneapolis",
  "tampa",
  "orlando",
  "charlotte",
  "detroit",
  "salt-lake-city",
  "pittsburgh",
  "sacramento",
  "kansas-city",
  "st-louis",
  "cincinnati",
  "milwaukee",
  "raleigh",
  "memphis",
  "new-orleans",
  "richmond",
  "louisville",
  "buffalo",
  "rochester",
  "hartford",
  "tucson",
  "albuquerque",
  "honolulu",
  "boise",
  "omaha",
  "tulsa",
  "colorado-springs",
] as const;

const everywhere = (): ProviderCoverage =>
  Object.fromEntries(MODELLED_MARKETS.map((m) => [m, NATIONWIDE]));

export const MARKET_COVERAGE: Partial<Record<ProviderId, ProviderCoverage>> = {
  uber: everywhere(),
  lyft: everywhere(),

  /*
   * Curb is a taxi e-hail network bound to individual city taxi fleets, so
   * coverage is per-fleet and cannot be assumed from one city to the next.
   *
   * New York is the one entry that does not require an outside check: Curb is
   * the TLC-licensed e-hail app for NYC yellow cabs, and this repo's own fare
   * model for it is the TLC meter (see fare-engine.ts `inManhattanBelow96`,
   * the Manhattan↔JFK flat, and the Curb quote's own note).
   *
   * Every other Curb market is UNVERIFIED by omission. Curb publishes its city
   * list; somebody should read it and add entries here with a real date.
   */
  curb: {
    "new-york": {
      status: "OPERATES",
      source:
        "TLC-licensed e-hail for NYC yellow cabs; this repo models its fare with the TLC meter and the Manhattan-JFK flat.",
      verifiedOn: null,
    },
  },

  /*
   * Empower: no confirmed market. It operates in a small number of cities and
   * nobody has checked which, so it surfaces nowhere until somebody does. The
   * previous behaviour — 49 markets, no evidence — is what this file exists to
   * stop.
   */
  empower: {},
};

/** What a provider's presence in a market is, with its evidence. */
export function coverageFor(provider: ProviderId, marketId: string): CoverageEntry {
  return (
    MARKET_COVERAGE[provider]?.[marketId] ?? {
      status: "UNVERIFIED",
      source: "No coverage entry for this provider and market.",
      verifiedOn: null,
    }
  );
}

/** Only a confirmed presence may be shown to a rider. */
export function operatesIn(provider: ProviderId, marketId: string): boolean {
  return coverageFor(provider, marketId).status === "OPERATES";
}

export function providersOperatingIn(
  marketId: string,
  candidates: readonly ProviderId[],
): ProviderId[] {
  return candidates.filter((p) => operatesIn(p, marketId));
}

export interface OmittedProvider {
  provider: ProviderId;
  status: Exclude<CoverageStatus, "OPERATES">;
  /** One clause, for the "not available here" line. */
  reason: string;
}

/**
 * The providers held back, and why — so they can be named rather than silently
 * disappearing. A rider who expected to see Curb deserves to know whether it
 * does not run here or whether RideLens simply has not checked.
 */
export function omittedProvidersIn(
  marketId: string,
  candidates: readonly ProviderId[],
): OmittedProvider[] {
  const out: OmittedProvider[] = [];
  for (const provider of candidates) {
    const entry = coverageFor(provider, marketId);
    if (entry.status === "OPERATES") continue;
    out.push({
      provider,
      status: entry.status,
      reason:
        entry.status === "DOES_NOT_OPERATE"
          ? "does not operate in this market"
          : "coverage in this market is unconfirmed, so it is left out rather than guessed",
    });
  }
  return out;
}
