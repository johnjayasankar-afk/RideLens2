/**
 * The composition has one job: add up.
 *
 * A breakdown that is nearly right is worse than no breakdown, because the
 * only reader who checks it is the one who already suspects the number. So
 * this runs the same seeded fuzzer the fare invariants use, composes every
 * fare it produces, and holds the slices to the cent.
 */

import { describe, expect, it } from "vitest";

import { composeFare, reconciles } from "@/lib/domain/fare-composition";
import { computeProductFare, type FareProduct } from "@/lib/sources/ratecard/fare-engine";
import type { NormalizedQuote } from "@/lib/domain/types";

const SAMPLES = 600;

type Provider = "uber" | "lyft" | "empower" | "curb";
const PRODUCTS: Array<{ product: FareProduct; provider: Provider }> = [
  { product: "uberx", provider: "uber" },
  { product: "comfort", provider: "uber" },
  { product: "uberxl", provider: "uber" },
  { product: "lyft", provider: "lyft" },
  { product: "lyft_xl", provider: "lyft" },
  { product: "taxi", provider: "curb" },
  { product: "empower", provider: "empower" },
];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A quote shaped exactly as the rate-card source builds one. */
function quoteFrom(
  fare: ReturnType<typeof computeProductFare>,
  provider: Provider,
  product: FareProduct,
): NormalizedQuote {
  return {
    id: `${provider}:${product}`,
    provider,
    providerProductId: product,
    providerProductName: product,
    normalizedCategory: "STANDARD",
    priceType: "ESTIMATE_RANGE",
    priceMinMinor: Math.round(fare.low * 100),
    priceMaxMinor: Math.round(fare.high * 100),
    displayPriceMinor: Math.round(fare.low * 100),
    rankingPriceMinor: Math.round(((fare.low + fare.high) / 2) * 100),
    currency: "USD",
    pickupEtaSeconds: 180,
    tripDurationSeconds: 1200,
    distanceMeters: 16000,
    availability: "AVAILABLE",
    source: "public_rate_card",
    sourceMethod: "public_rate_card",
    accountContext: "PUBLIC",
    receivedAt: "2026-09-27T12:00:00.000Z",
    providerTimestamp: null,
    expiresAt: null,
    freshness: "LIVE",
    bookingHandoff: null,
    confidenceClass: "MEDIUM",
    metadata: {
      centerFare: fare.center,
      rateCardDollars: fare.rateCardDollars,
      feesDollars: fare.feesDollars,
      feesInsideRateCard: fare.feesInsideRateCard,
      feeBreakdown: fare.feeBreakdown,
      anchorWeight: fare.anchorWeight,
      band: fare.band,
      demandCenter: fare.demandCenter,
    },
  };
}

const cases = (() => {
  const r = rng(20260928);
  return Array.from({ length: SAMPLES }, () => {
    const pick = PRODUCTS[Math.floor(r() * PRODUCTS.length)]!;
    const lat = 40.4 + r() * 1.2;
    const lng = -74.4 + r() * 1.4;
    return {
      product: pick.product,
      provider: pick.provider,
      pickup: { lat, lng },
      destination: { lat: lat + (r() - 0.5) * 0.6, lng: lng + (r() - 0.5) * 0.6 },
      miles: 0.2 + r() * 59.8,
      osrmMinutes: 1 + r() * 179,
      now: new Date(Date.UTC(2026, 0, 1) + Math.floor(r() * 365 * 86_400_000)),
      weatherSurgeLift: 1 + r() * 1.5,
    };
  });
})();

describe("every composition the engine can produce", () => {
  it("adds up to the centre, to the cent", () => {
    for (const c of cases) {
      const fare = computeProductFare(c);
      const composition = composeFare(quoteFrom(fare, c.provider, c.product));
      expect(composition, `${c.provider}/${c.product} composed to null`).not.toBeNull();
      expect(
        reconciles(composition!),
        `${c.provider}/${c.product} ${c.miles.toFixed(1)}mi: ` +
          `${composition!.slices.map((s) => `${s.id}=${s.dollars}`).join(" + ")} ` +
          `≠ ${composition!.centerDollars}`,
      ).toBe(true);
    }
  });

  /*
   * The ride is the thing being bought. A decomposition where fees outweigh
   * it on an ordinary trip means the two subtotal conventions got crossed —
   * the specific failure `feesInsideRateCard` exists to prevent.
   */
  it("never makes the fees larger than the ride itself", () => {
    let checked = 0;
    for (const c of cases) {
      if (c.miles < 3) continue;
      const fare = computeProductFare(c);
      const composition = composeFare(quoteFrom(fare, c.provider, c.product))!;
      const ride = composition.slices.find((s) => s.id === "metered")?.dollars ?? 0;
      const fees = composition.slices.find((s) => s.id === "fees")?.dollars ?? 0;
      expect(fees, `${c.provider}/${c.product} ${c.miles.toFixed(1)}mi`).toBeLessThan(ride);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("names enough of the fees that the unnamed remainder stays small", () => {
    for (const c of cases) {
      const fare = computeProductFare(c);
      const composition = composeFare(quoteFrom(fare, c.provider, c.product))!;
      const fees = composition.slices.find((s) => s.id === "fees");
      if (!fees || fees.dollars < 1) continue;
      const other = fees.items.find((i) => i.label.startsWith("Other"));
      expect(Math.abs(other?.dollars ?? 0)).toBeLessThan(fees.dollars * 0.5);
    }
  });

  it("lists the itemised fees in descending order", () => {
    for (const c of cases.slice(0, 120)) {
      const fare = computeProductFare(c);
      const composition = composeFare(quoteFrom(fare, c.provider, c.product))!;
      const items = composition.slices.find((s) => s.id === "fees")?.items ?? [];
      const named = items.filter((i) => !i.label.startsWith("Other")).map((i) => i.dollars);
      expect(named).toEqual([...named].sort((a, b) => b - a));
    }
  });
});

describe("the flat-fare path", () => {
  /*
   * Manhattan ↔ JFK by taxi is the case that breaks a naive decomposition:
   * `rateCardDollars` is the bare $70 and the stack sits on top of it, the
   * opposite of every other fare the engine produces. Read the wrong way the
   * ride shrinks by exactly the fee stack and nothing fails.
   */
  const jfk = {
    product: "taxi" as const,
    provider: "curb" as const,
    pickup: { lat: 40.7225, lng: -73.9945 },
    destination: { lat: 40.6446, lng: -73.7797 },
    miles: 17.9,
    osrmMinutes: 33,
    now: new Date("2026-09-27T18:00:00Z"),
    weatherSurgeLift: 1,
  };

  it("keeps the flat fare whole instead of subtracting the stack from it", () => {
    const fare = computeProductFare(jfk);
    expect(fare.feesInsideRateCard).toBe(false);
    const composition = composeFare(quoteFrom(fare, "curb", "taxi"))!;
    const ride = composition.slices.find((s) => s.id === "metered")!;
    expect(ride.dollars).toBeCloseTo(fare.rateCardDollars, 2);
    expect(reconciles(composition)).toBe(true);
  });

  /* The flat fare is the subtotal, not an addition to it. */
  it("does not list the flat fare among the surcharges", () => {
    const composition = composeFare(quoteFrom(computeProductFare(jfk), "curb", "taxi"))!;
    const fees = composition.slices.find((s) => s.id === "fees");
    for (const item of fees?.items ?? []) {
      expect(item.dollars).toBeLessThan(composition.centerDollars * 0.5);
    }
  });

  /* A metered trip is the other convention, and must not regress into this one. */
  it("reads a metered fare the other way round", () => {
    const fare = computeProductFare({ ...jfk, product: "uberx", provider: "uber" });
    expect(fare.feesInsideRateCard).toBe(true);
    const composition = composeFare(quoteFrom(fare, "uber", "uberx"))!;
    const ride = composition.slices.find((s) => s.id === "metered")!;
    expect(ride.dollars).toBeCloseTo(fare.rateCardDollars - fare.feesDollars, 2);
  });
});

describe("what it refuses", () => {
  const bare: NormalizedQuote = {
    ...quoteFrom(computeProductFare(cases[0]!), "uber", "uberx"),
    metadata: {},
  };

  it("returns nothing for a quote with no arithmetic behind it", () => {
    expect(composeFare(bare)).toBeNull();
  });

  it("returns nothing when only part of the arithmetic survived", () => {
    expect(composeFare({ ...bare, metadata: { centerFare: 40 } })).toBeNull();
    expect(composeFare({ ...bare, metadata: { rateCardDollars: 40, feesDollars: 2 } })).toBeNull();
  });

  /* Multipliers in a list of dollars get read as dollars. */
  it("keeps factors out of the fee items", () => {
    const fare = computeProductFare(cases[3]!);
    const quote = quoteFrom(fare, "uber", "uberx");
    quote.metadata.feeBreakdown = {
      ...(quote.metadata.feeBreakdown as Record<string, number>),
      out_of_town_factor: 1.18,
      directional_asymmetry: 1.08,
    };
    const items = composeFare(quote)!.slices.find((s) => s.id === "fees")?.items ?? [];
    expect(items.map((i) => i.label).join(" ")).not.toMatch(/factor|asymmetry/i);
  });

  /* Sessions priced before the engine stated its convention still decompose. */
  it("falls back to the structural signal when the flag is absent", () => {
    const fare = computeProductFare(jfkTaxi());
    const quote = quoteFrom(fare, "curb", "taxi");
    delete quote.metadata.feesInsideRateCard;
    const composition = composeFare(quote)!;
    expect(composition.slices.find((s) => s.id === "metered")!.dollars).toBeCloseTo(
      fare.rateCardDollars,
      2,
    );
  });
});

function jfkTaxi() {
  return {
    product: "taxi" as const,
    provider: "curb" as const,
    pickup: { lat: 40.7225, lng: -73.9945 },
    destination: { lat: 40.6446, lng: -73.7797 },
    miles: 17.9,
    osrmMinutes: 33,
    now: new Date("2026-09-27T18:00:00Z"),
    weatherSurgeLift: 1,
  };
}

describe("a fee stack that comes out negative", () => {
  /*
   * `marketplace.additiveDollars` is signed, so `feesDollars` can be. The
   * fuzzer found a $78.90 fare whose entire fee stack was −$0.11, and the
   * first version of this module printed "The ride itself: $79.01" under it.
   */
  const negative: NormalizedQuote = {
    ...quoteFrom(computeProductFare(cases[0]!), "empower", "empower"),
    priceMinMinor: 7653,
    priceMaxMinor: 8127,
    metadata: {
      centerFare: 78.9,
      rateCardDollars: 78.89,
      feesDollars: -0.11,
      feesInsideRateCard: true,
      feeBreakdown: { marketplace_rules: -0.11 },
      anchorWeight: 0,
      band: 0.03,
      demandCenter: 1,
    },
  };

  it("still adds up", () => {
    const c = composeFare(negative)!;
    expect(reconciles(c)).toBe(true);
    expect(c.slices.reduce((t, s) => t + s.dollars, 0)).toBeCloseTo(78.9, 2);
  });

  it("does not offer a negative surcharge line", () => {
    const c = composeFare(negative)!;
    expect(c.slices.find((s) => s.id === "fees")).toBeUndefined();
    for (const slice of c.slices) expect(slice.dollars).toBeGreaterThan(0);
  });
});

describe("what the last slice is called", () => {
  /*
   * Two unrelated things land in this slice and they are rarely both present.
   * "Corridor calibration" was printed over a Brooklyn → Manhattan taxi with
   * no corridor anchor at all — the cause was the 0.9 directional adjustment,
   * which the slice's own detail line said correctly while its label did not.
   */
  const brooklynToManhattan = {
    product: "taxi" as const,
    provider: "curb" as const,
    pickup: { lat: 40.6782, lng: -73.9442 },
    destination: { lat: 40.758, lng: -73.9855 },
    miles: 10.8,
    osrmMinutes: 29,
    now: new Date("2026-09-28T23:12:00Z"),
    weatherSurgeLift: 1,
  };

  it("names the direction when that is what moved it", () => {
    const fare = computeProductFare(brooklynToManhattan);
    expect(fare.anchorId, "this route must have no corridor anchor").toBeNull();
    expect(fare.feeBreakdown.directional_asymmetry).toBe(0.9);

    const slice = composeFare(quoteFrom(fare, "curb", "taxi"))!.slices.find(
      (s) => s.id === "calibration",
    )!;
    expect(slice.label).toBe("Direction of travel");
    expect(slice.dollars).toBeLessThan(0);
    expect(slice.detail).toContain("into Manhattan");
  });

  it("names the corridor when a corridor is what moved it", () => {
    /* Manhattan below 96th to JFK: a published anchor, and no directional
       adjustment, because both ends are inside the same box. */
    const fare = computeProductFare({
      ...brooklynToManhattan,
      product: "uberx",
      provider: "uber",
      pickup: { lat: 40.7549, lng: -73.984 },
      destination: { lat: 40.6413, lng: -73.7781 },
      miles: 17.4,
      osrmMinutes: 38,
    });
    expect(fare.anchorId).toBe("manhattan_to_jfk");
    const slice = composeFare(quoteFrom(fare, "uber", "uberx"))!.slices.find(
      (s) => s.id === "calibration",
    );
    expect(slice?.label).toMatch(/^Corridor/);
    expect(slice?.detail).toContain("corridor averages");
  });

  /* A label that says "corridor" has to have a corridor behind it. */
  it("never claims a corridor when the anchor did not apply", () => {
    for (const c of cases.slice(0, 400)) {
      const fare = computeProductFare(c);
      if (fare.anchorWeight > 0) continue;
      const slice = composeFare(quoteFrom(fare, c.provider, c.product))!.slices.find(
        (s) => s.id === "calibration",
      );
      expect(slice?.label ?? "", `${c.provider}/${c.product}`).not.toMatch(/corridor/i);
    }
  });
});
