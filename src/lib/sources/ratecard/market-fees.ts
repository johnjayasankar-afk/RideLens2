/**
 * Which markets have a real regulatory fee model, and which do not.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FEE STACK IS NEW YORK'S                                              │
 * │                                                                          │
 * │ fare-engine.ts implements inManhattanBelow96 (the NYS congestion         │
 * │ surcharge), inManhattanBelow60 (the MTA relief zone), the Black Car      │
 * │ Fund, NY sales tax and Westchester corridor anchors. tripFees branches   │
 * │ on `cityId === "new-york"` and gives every other market a flat $3.50     │
 * │ airport add-on and nothing else.                                         │
 * │                                                                          │
 * │ Chicago has a ground transportation tax and an airport departure tax.    │
 * │ Seattle, Portland and Washington DC each levy their own per-trip fees.   │
 * │ None of them is modeled, and the UI presented all of it at the same      │
 * │ confidence as a New York trip priced from the actual TLC rules.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── On what is missing from this file ──────────────────────────────────────
 *
 * The brief asks for real fee models for three more markets, each with a
 * cited source and a verification date. Those are regulatory schedules with
 * specific amounts and effective dates, and writing plausible-looking numbers
 * here without reading the ordinances would be the exact failure this product
 * exists to avoid — worse than the gap, because a fabricated fee is invisible
 * whereas a missing one now announces itself.
 *
 * So the mechanism is here and the models are not. A market without one
 * widens its band and says so on the card. Each entry below lists what
 * specifically needs modelling, so adding it is a research task rather than a
 * design one.
 */

export interface MarketFeeModel {
  /** Whether the regulatory stack for this market is actually implemented. */
  modeled: boolean;
  /** ISO date the schedule was last checked against its source. */
  verifiedOn: string | null;
  /** Where the amounts came from, or what would have to be read to add them. */
  source: string;
  /** Named components, for the provenance sheet. */
  components: string[];
}

const UNMODELED = (source: string, components: string[]): MarketFeeModel => ({
  modeled: false,
  verifiedOn: null,
  source,
  components,
});

export const MARKET_FEE_MODELS: Record<string, MarketFeeModel> = {
  "new-york": {
    modeled: true,
    // The implementation predates this file; the date records when the rules
    // it encodes were last checked, not when the code was written.
    verifiedOn: "2026-09-03",
    source:
      "NYC TLC rate rules and NY State tax law, as implemented in fare-engine.ts: the congestion surcharge zones, the Black Car Fund levy, sales tax, the Manhattan–JFK flat fare and the tolled crossings.",
    components: [
      "NYS congestion surcharge (Manhattan below 96th St)",
      "MTA congestion relief (Manhattan below 60th St)",
      "Black Car Fund",
      "NY sales tax",
      "Manhattan–JFK flat fare",
      "Tolled crossings",
    ],
  },

  chicago: UNMODELED(
    "Chicago Municipal Code ground transportation tax and the airport departure tax would have to be read for current amounts and effective dates.",
    ["Ground transportation tax", "Airport departure tax", "Downtown zone surcharge"],
  ),
  "washington-dc": UNMODELED(
    "DC's per-trip gross receipts surcharge on for-hire vehicles would have to be read for the current rate.",
    ["DC for-hire gross receipts surcharge", "Airport access fees (DCA/IAD)"],
  ),
  seattle: UNMODELED(
    "Seattle's per-trip TNC fee and King County levies would have to be read for current amounts.",
    ["Seattle per-trip TNC fee", "King County surcharge", "Sea-Tac airport fee"],
  ),
};

/**
 * The fee model for a market, or an explicit absence.
 *
 * A market with no entry is not silently treated as fee-free — it gets the
 * unmodeled answer, which widens the band and discloses.
 */
export function feeModelFor(marketId: string): MarketFeeModel {
  return (
    MARKET_FEE_MODELS[marketId] ??
    UNMODELED(
      "No regulatory fee model has been written for this market. Local per-trip fees, airport levies and congestion charges are not included in the figure.",
      [],
    )
  );
}

export function feesAreModeled(marketId: string): boolean {
  return feeModelFor(marketId).modeled;
}

/**
 * One sentence for the card, when the stack is not modeled.
 *
 * Says what is missing rather than that something is missing — a rider can
 * act on "local per-trip fees are not included" and cannot act on "low
 * confidence".
 */
export function unmodeledFeeNote(marketId: string, marketName: string): string | null {
  const model = feeModelFor(marketId);
  if (model.modeled) return null;
  const named = model.components.length
    ? ` Not included: ${model.components.join(", ").toLowerCase()}.`
    : "";
  return `Regulatory fees are not modeled for ${marketName}, so this band is widened to cover them.${named}`;
}
