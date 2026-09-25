/**
 * What happens when two sources price the same ride differently.
 *
 * The reconciler is the one place in the codebase where the product is
 * holding two contradictory numbers and has to put a single row on screen.
 * The temptation in that position is to split the difference, and the whole
 * design rests on not doing that: it picks a source and names the
 * disagreement. `shows a number somebody actually reported` is the test that
 * pins it down.
 */
import { describe, expect, it } from "vitest";

import { rankQuotes } from "@/lib/domain/ranking";
import { reconcileQuotes, scoreCandidate } from "@/lib/domain/reconciler";
import type { NormalizedQuote } from "@/lib/domain/types";

let seq = 0;

function quote(over: Partial<NormalizedQuote> = {}): NormalizedQuote {
  seq += 1;
  const min = over.priceMinMinor ?? 2500;
  const max = over.priceMaxMinor ?? min;
  return {
    id: `q${seq}`,
    provider: "uber",
    providerProductId: "uberx",
    providerProductName: "UberX",
    normalizedCategory: "STANDARD",
    priceType: "ESTIMATE_RANGE",
    priceMinMinor: min,
    priceMaxMinor: max,
    displayPriceMinor: min,
    rankingPriceMinor: Math.round((min + max) / 2),
    currency: "USD",
    pickupEtaSeconds: 180,
    tripDurationSeconds: 1800,
    distanceMeters: 8000,
    availability: "AVAILABLE",
    source: "public_rate_card",
    sourceMethod: "public_rate_card",
    accountContext: "PUBLIC",
    receivedAt: new Date().toISOString(),
    providerTimestamp: null,
    expiresAt: null,
    freshness: "LIVE",
    bookingHandoff: null,
    confidenceClass: "MEDIUM",
    metadata: {},
    ...over,
  };
}

describe("grouping", () => {
  it("collapses the same product from two sources into one row", () => {
    const a = quote({ source: "obi", rankingPriceMinor: 2500 });
    const b = quote({ source: "fixture", rankingPriceMinor: 2500 });
    const { visible } = reconcileQuotes([a, b]);
    expect(visible).toHaveLength(1);
  });

  it("keeps genuinely different products apart", () => {
    const uberx = quote({ provider: "uber", providerProductName: "UberX" });
    const black = quote({
      provider: "uber",
      providerProductName: "Uber Black",
      normalizedCategory: "PREMIUM",
    });
    const lyft = quote({ provider: "lyft", providerProductName: "Lyft" });
    expect(reconcileQuotes([uberx, black, lyft]).visible).toHaveLength(3);
  });

  /*
   * Product names arrive spelled however each source spells them. If the key
   * did not normalise, the same ride would appear twice and the rider would
   * see two prices for one car.
   */
  it("treats spelling differences as the same product", () => {
    const a = quote({ source: "obi", providerProductName: "UberX" });
    const b = quote({ source: "curb_flow", providerProductName: "uber-x" });
    const c = quote({ source: "fixture", providerProductName: "Uber X" });
    expect(reconcileQuotes([a, b, c]).visible).toHaveLength(1);
  });

  it("does not merge the same product name across providers", () => {
    const a = quote({ provider: "uber", providerProductName: "Standard" });
    const b = quote({ provider: "lyft", providerProductName: "Standard" });
    expect(reconcileQuotes([a, b]).visible).toHaveLength(2);
  });

  it("handles an empty comparison", () => {
    const r = reconcileQuotes([]);
    expect(r.visible).toEqual([]);
    expect(r.discrepancies).toEqual([]);
  });
});

describe("which source wins", () => {
  it("prefers a licensed aggregator over a fixture", () => {
    const obi = quote({ source: "obi" });
    const fixture = quote({ source: "fixture" });
    expect(reconcileQuotes([fixture, obi]).visible[0]).toBe(obi);
  });

  it("prefers an upfront quote over a metered guess from the same source", () => {
    const upfront = quote({ source: "curb_flow", priceType: "UPFRONT_QUOTE" });
    const metered = quote({ source: "curb_flow", priceType: "METERED_ESTIMATE" });
    expect(reconcileQuotes([metered, upfront]).visible[0]).toBe(upfront);
  });

  it("prefers a quote taken against the rider's own account", () => {
    const linked = quote({ source: "lyft_authorized", accountContext: "ACCOUNT_LINKED" });
    const anon = quote({ source: "lyft_authorized", accountContext: "PUBLIC" });
    expect(reconcileQuotes([anon, linked]).visible[0]).toBe(linked);
  });

  /*
   * The -50 expiry penalty is not enough on its own: a source bonus of 100
   * absorbs it, and an expired Obi quote outscored a live modeled one.
   * Because reconcile runs before rank, and rank drops EXPIRED, that cost
   * the rider the entire ride option — the live sibling was discarded here
   * and the expired winner was filtered out downstream.
   */
  it("never lets an expired quote beat a live one, at any pedigree", () => {
    const expiredBest = quote({ source: "obi", freshness: "EXPIRED" });
    const liveWorst = quote({ source: "fixture", freshness: "LIVE" });
    // The raw score still favours the expired one...
    expect(scoreCandidate(expiredBest)).toBeGreaterThan(scoreCandidate(liveWorst));
    // ...and it loses anyway.
    expect(reconcileQuotes([expiredBest, liveWorst]).visible[0]).toBe(liveWorst);
  });

  it("survives ranking, which is where the option used to disappear", () => {
    const expiredBest = quote({ source: "obi", freshness: "EXPIRED" });
    const liveModeled = quote({ source: "public_rate_card", freshness: "LIVE" });
    const { visible } = reconcileQuotes([expiredBest, liveModeled]);
    expect(rankQuotes(visible, "cheapest", "ALL")).toHaveLength(1);
  });

  it("still ranks by score between two expired quotes", () => {
    const obi = quote({ source: "obi", freshness: "EXPIRED" });
    const fixture = quote({ source: "fixture", freshness: "EXPIRED" });
    expect(reconcileQuotes([fixture, obi]).visible[0]).toBe(obi);
  });

  /*
   * public_rate_card was missing from the quality table and fell through to
   * the unknown-source fallback of 5 — below fixture's 10. The only source
   * enabled by default ranked last, so in any environment with fixtures on,
   * fake data outranked the real modeled quote for the same product.
   */
  it("ranks the modeled rate card above a fixture", () => {
    const modeled = quote({ source: "public_rate_card" });
    const fixture = quote({ source: "fixture" });
    expect(scoreCandidate(modeled)).toBeGreaterThan(scoreCandidate(fixture));
    expect(reconcileQuotes([fixture, modeled]).visible[0]).toBe(modeled);
  });

  it("still ranks the modeled rate card below every real partner feed", () => {
    const modeled = quote({ source: "public_rate_card" });
    for (const partner of ["obi", "lyft_authorized", "curb_flow", "empower_authorized"]) {
      expect(scoreCandidate(quote({ source: partner }))).toBeGreaterThan(scoreCandidate(modeled));
    }
  });

  it("gives an unrecognised source the benefit of nothing", () => {
    const known = quote({ source: "public_rate_card" });
    const stranger = quote({ source: "some_new_thing" });
    expect(scoreCandidate(stranger)).toBeLessThan(scoreCandidate(known));
  });
});

describe("naming the disagreement", () => {
  it("says nothing when two sources roughly agree", () => {
    const a = quote({ source: "obi", rankingPriceMinor: 2500 });
    const b = quote({ source: "fixture", rankingPriceMinor: 2600 });
    expect(reconcileQuotes([a, b]).discrepancies).toHaveLength(0);
  });

  it("flags a gap large in absolute terms", () => {
    const a = quote({ source: "obi", rankingPriceMinor: 8000 });
    const b = quote({ source: "fixture", rankingPriceMinor: 8400 });
    const [d] = reconcileQuotes([a, b]).discrepancies;
    expect(d).toBeDefined();
    expect(d!.deltaMinor).toBe(400);
    expect(d!.message).toContain("$4.00");
  });

  /*
   * $2 apart is immaterial on a $40 fare and is most of the price on a $4
   * one, so the absolute threshold alone would stay silent exactly where a
   * rider would care most.
   */
  it("flags a gap large only in relative terms", () => {
    const a = quote({ source: "obi", rankingPriceMinor: 600 });
    const b = quote({ source: "fixture", rankingPriceMinor: 800 });
    const [d] = reconcileQuotes([a, b]).discrepancies;
    expect(d).toBeDefined();
    expect(d!.deltaMinor).toBe(200);
  });

  it("reports the widest gap when several sources disagree", () => {
    const winner = quote({ source: "obi", rankingPriceMinor: 5000 });
    const near = quote({ source: "curb_flow", rankingPriceMinor: 5400 });
    const far = quote({ source: "fixture", rankingPriceMinor: 9000 });
    const [d] = reconcileQuotes([winner, near, far]).discrepancies;
    expect(d!.deltaMinor).toBe(4000);
    // Every disagreeing source is carried, not just the worst.
    expect(d!.quotes).toHaveLength(3);
    expect(d!.quotes[0]).toBe(winner);
  });

  it("tells the rider where to confirm", () => {
    const a = quote({ provider: "lyft", source: "obi", rankingPriceMinor: 3000 });
    const b = quote({ provider: "lyft", source: "fixture", rankingPriceMinor: 5000 });
    const [d] = reconcileQuotes([a, b]).discrepancies;
    expect(d!.provider).toBe("lyft");
    expect(d!.message).toMatch(/confirm in lyft/i);
  });
});

describe("the thing this must never do", () => {
  /*
   * With two contradictory numbers in hand, the reconciler could average
   * them and show a figure that is tidy, defensible and reported by nobody.
   * Identity rather than equality: the visible row must be one of the
   * objects that came in.
   */
  it("shows a number somebody actually reported", () => {
    const a = quote({ source: "obi", priceMinMinor: 2000, priceMaxMinor: 2000 });
    const b = quote({ source: "fixture", priceMinMinor: 6000, priceMaxMinor: 6000 });
    const { visible } = reconcileQuotes([a, b]);

    expect(visible).toHaveLength(1);
    expect([a, b]).toContain(visible[0]);
    expect(visible[0]!.rankingPriceMinor).not.toBe(4000);
  });

  it("loses nothing on the way through", () => {
    const all = [
      quote({ source: "obi" }),
      quote({ source: "fixture" }),
      quote({ provider: "lyft", source: "obi" }),
    ];
    const r = reconcileQuotes(all);
    expect(r.allCandidates).toEqual(all);
    // Collapsed for display, still available underneath.
    expect(r.visible.length).toBeLessThan(r.allCandidates.length);
  });

  it("does not mutate what it was given", () => {
    const a = quote({ source: "obi", rankingPriceMinor: 2500 });
    const b = quote({ source: "fixture", rankingPriceMinor: 9000 });
    const before = JSON.stringify([a, b]);
    reconcileQuotes([a, b]);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});
