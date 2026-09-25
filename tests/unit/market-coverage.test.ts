/**
 * Providers may only be shown where a rider can actually hail them.
 *
 * The rate-card source emitted a `curb_taxi` and an `empower_standard` quote in
 * all 49 modelled markets, with `providersSurfaced` hardcoded. Their own notes
 * cite the New York TLC meter and "Obi Q1 2026 NYC receipts", so a rider in
 * Phoenix was shown a Curb fare computed from the New York taxi meter for a
 * service they cannot hail.
 */
import { describe, expect, it } from "vitest";

import {
  MARKET_COVERAGE,
  MODELLED_MARKETS,
  coverageFor,
  omittedProvidersIn,
  operatesIn,
  providersOperatingIn,
} from "@/lib/domain/market-coverage";
import type { ProviderId } from "@/lib/domain/types";

/** Everything PublicRateCardQuoteSource knows how to price. */
const RATE_CARD_PROVIDERS: ProviderId[] = ["uber", "lyft", "curb", "empower"];

describe("only confirmed coverage is surfaced", () => {
  /*
   * The regression guard the brief asked for: nothing may be emitted for a
   * market that has no OPERATES entry backing it.
   */
  it("never surfaces a provider in a market with no coverage entry", () => {
    for (const market of MODELLED_MARKETS) {
      for (const provider of providersOperatingIn(market, RATE_CARD_PROVIDERS)) {
        const entry = MARKET_COVERAGE[provider]?.[market];
        expect(entry, `${provider} surfaced in ${market} with no entry`).toBeDefined();
        expect(entry!.status, `${provider} in ${market}`).toBe("OPERATES");
      }
    }
  });

  it("treats an unknown market as unverified rather than defaulting to a busy one", () => {
    // The old nearestCity defaulted to "new-york"; coverage must not inherit
    // that habit for a market id it has never heard of.
    for (const provider of RATE_CARD_PROVIDERS) {
      expect(operatesIn(provider, "atlantis"), provider).toBe(false);
      expect(coverageFor(provider, "atlantis").status).toBe("UNVERIFIED");
    }
  });

  it("does not show a New-York-calibrated taxi fare in Phoenix", () => {
    expect(operatesIn("curb", "new-york")).toBe(true);
    for (const market of ["phoenix", "san-antonio", "boise", "tulsa"]) {
      expect(operatesIn("curb", market), market).toBe(false);
    }
  });

  /*
   * Empower has no confirmed market, so it surfaces nowhere. That is the
   * correct failure direction — it was previously surfacing in all 49 on the
   * strength of nothing — and the fix is to verify its service area, not to
   * relax this.
   */
  it("holds back a provider whose coverage nobody has checked", () => {
    for (const market of MODELLED_MARKETS) {
      expect(operatesIn("empower", market), market).toBe(false);
    }
  });

  it("keeps the nationwide networks available everywhere they are modelled", () => {
    for (const market of MODELLED_MARKETS) {
      expect(operatesIn("uber", market), market).toBe(true);
      expect(operatesIn("lyft", market), market).toBe(true);
    }
  });
});

describe("what is held back is named, not dropped", () => {
  it("reports every withheld provider with a reason", () => {
    const omitted = omittedProvidersIn("phoenix", RATE_CARD_PROVIDERS);
    const names = omitted.map((o) => o.provider).sort();
    expect(names).toEqual(["curb", "empower"]);
    for (const o of omitted) {
      expect(o.reason.length).toBeGreaterThan(0);
    }
  });

  /*
   * "We checked and it isn't here" and "we haven't checked" are different
   * sentences, and a rider is owed the true one — the same distinction
   * PRODUCT_SPEC.md draws between "not connected" and "no cars".
   */
  it("distinguishes unconfirmed from confirmed-absent", () => {
    const [curb] = omittedProvidersIn("phoenix", ["curb"]);
    expect(curb!.status).toBe("UNVERIFIED");
    expect(curb!.reason).toMatch(/unconfirmed/i);
    expect(curb!.reason).not.toMatch(/does not operate/i);
  });

  it("names nothing in a market where everything is confirmed", () => {
    expect(omittedProvidersIn("new-york", ["uber", "lyft", "curb"])).toEqual([]);
  });
});

describe("the coverage table is honest about itself", () => {
  /*
   * An entry that claims a verification date must be a real claim, and an
   * entry resting on background knowledge must say so rather than borrowing
   * the authority of a checked source.
   */
  it("gives every OPERATES entry a non-empty source", () => {
    for (const [provider, markets] of Object.entries(MARKET_COVERAGE)) {
      for (const [market, entry] of Object.entries(markets ?? {})) {
        if (!entry) continue;
        expect(entry.source.trim().length, `${provider}/${market}`).toBeGreaterThan(20);
      }
    }
  });

  it("never dates a claim it did not check", () => {
    for (const markets of Object.values(MARKET_COVERAGE)) {
      for (const entry of Object.values(markets ?? {})) {
        if (!entry?.verifiedOn) continue;
        // A date must be a real ISO date, not a placeholder.
        expect(Number.isNaN(Date.parse(entry.verifiedOn))).toBe(false);
        // And a dated claim must not be one that admits to being unchecked.
        expect(entry.source).not.toMatch(/background knowledge|not a per-market/i);
      }
    }
  });

  it("covers only markets the rate card actually models", () => {
    const modelled = new Set<string>(MODELLED_MARKETS);
    for (const [provider, markets] of Object.entries(MARKET_COVERAGE)) {
      for (const market of Object.keys(markets ?? {})) {
        expect(modelled.has(market), `${provider} lists unmodelled market ${market}`).toBe(true);
      }
    }
  });
});
