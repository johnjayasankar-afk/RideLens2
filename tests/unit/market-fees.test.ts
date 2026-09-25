/**
 * A fee stack that only exists for one city.
 *
 * fare-engine.ts implements the NYS congestion surcharge, the MTA relief
 * zone, the Black Car Fund and NY sales tax; tripFees branches on
 * `cityId === "new-york"` and hands every other market a flat $3.50 airport
 * add-on. Chicago's ground transportation tax, DC's gross receipts surcharge
 * and Seattle's per-trip TNC fee are all absent — and every one of those
 * trips was presented at the same confidence as a New York trip priced from
 * the real rules.
 */
import { describe, expect, it } from "vitest";

import { MODELLED_MARKETS } from "@/lib/domain/market-coverage";
import {
  MARKET_FEE_MODELS,
  feeModelFor,
  feesAreModeled,
  unmodeledFeeNote,
} from "@/lib/sources/ratecard/market-fees";

describe("which markets have a fee model", () => {
  it("has one for New York, with a verification date", () => {
    const model = feeModelFor("new-york");
    expect(model.modeled).toBe(true);
    expect(model.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(model.components).toContain("Black Car Fund");
  });

  /*
   * The default has to be "not modeled". A market nobody has written rules
   * for must not inherit silence as though it were fee-free.
   */
  it("treats an unknown market as unmodeled rather than fee-free", () => {
    const model = feeModelFor("atlantis");
    expect(model.modeled).toBe(false);
    expect(model.verifiedOn).toBeNull();
    expect(model.source.length).toBeGreaterThan(30);
  });

  it("does not claim a model for any market that lacks one", () => {
    for (const market of MODELLED_MARKETS) {
      if (feesAreModeled(market)) {
        // Anything claiming to be modeled must say where the amounts came
        // from and when they were checked.
        const model = feeModelFor(market);
        expect(model.verifiedOn, market).not.toBeNull();
        expect(model.components.length, market).toBeGreaterThan(0);
      }
    }
  });

  /*
   * Only New York, today. This is a deliberately uncomfortable assertion: it
   * fails the moment somebody adds a model, which is the point at which they
   * should also be adding a source and a date.
   */
  it("is honest that only one market is covered so far", () => {
    const modeled = MODELLED_MARKETS.filter(feesAreModeled);
    expect(modeled).toEqual(["new-york"]);
  });

  it("never dates a claim it did not check", () => {
    for (const [market, model] of Object.entries(MARKET_FEE_MODELS)) {
      if (model.modeled) continue;
      expect(model.verifiedOn, market).toBeNull();
    }
  });
});

describe("the disclosure", () => {
  it("says nothing where the stack is modeled", () => {
    expect(unmodeledFeeNote("new-york", "New York, NY")).toBeNull();
  });

  /*
   * A rider can act on "airport levies are not included" and cannot act on
   * "low confidence", so the note names the missing components.
   */
  it("names what is missing, not merely that something is", () => {
    const note = unmodeledFeeNote("chicago", "Chicago, IL")!;
    expect(note).toContain("Chicago, IL");
    expect(note).toMatch(/ground transportation tax/i);
    expect(note).toMatch(/airport departure tax/i);
    expect(note).toMatch(/widened/);
  });

  it("still discloses for a market with no entry at all", () => {
    const note = unmodeledFeeNote("tulsa", "Tulsa, OK")!;
    expect(note).toContain("Tulsa, OK");
    expect(note).toMatch(/not modeled/i);
  });
});
