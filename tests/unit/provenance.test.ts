/**
 * Where a number came from.
 *
 * The hero says "Live roads. Real rate cards. A marketplace that moves with
 * the clock" — all true, and a reader still comes away thinking they saw a
 * live Uber price. These tests pin the two claims that stop that: the chip
 * says what kind of number it is, and the rows show the arithmetic that
 * produced it.
 */
import { describe, expect, it } from "vitest";

import { bandNote, provenanceOf, provenanceRows } from "@/lib/domain/provenance";
import type { NormalizedQuote } from "@/lib/domain/types";
import { computeProductFare } from "@/lib/sources/ratecard/fare-engine";

const quote = (over: Partial<NormalizedQuote>): NormalizedQuote =>
  ({
    id: "q",
    provider: "uber",
    providerProductId: "uberx",
    providerProductName: "UberX",
    normalizedCategory: "STANDARD",
    priceType: "ESTIMATE_RANGE",
    priceMinMinor: 2400,
    priceMaxMinor: 2900,
    displayPriceMinor: 2400,
    rankingPriceMinor: 2650,
    currency: "USD",
    pickupEtaSeconds: 240,
    tripDurationSeconds: 1500,
    distanceMeters: 12000,
    availability: "AVAILABLE",
    source: "public_rate_card",
    sourceMethod: "public_rate_card",
    accountContext: "PUBLIC",
    receivedAt: new Date().toISOString(),
    providerTimestamp: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    freshness: "LIVE",
    bookingHandoff: null,
    confidenceClass: "LOW",
    metadata: {},
    ...over,
  }) as NormalizedQuote;

describe("what kind of number this is", () => {
  it("calls the rate-card model a model", () => {
    const p = provenanceOf(quote({ sourceMethod: "public_rate_card" }));
    expect(p.kind).toBe("MODELED_ESTIMATE");
    expect(p.modeled).toBe(true);
    expect(p.summary).toMatch(/No provider has quoted this trip/);
  });

  /*
   * Obi's market percentiles are not a quote addressed to anyone, and saying
   * so is the difference between a licensed feed and a screenshot of an app.
   */
  it("calls a licensed market feed a range, not a quote", () => {
    const p = provenanceOf(quote({ sourceMethod: "licensed_aggregation" }));
    expect(p.kind).toBe("MARKET_RANGE");
    expect(p.modeled).toBe(false);
    expect(p.summary).toMatch(/not a quote addressed to you/);
  });

  /*
   * The one distinction that matters most: a partner's locked fare is a
   * promise, a partner's estimate is a forecast, and they print identically.
   */
  it("separates a partner promise from a partner forecast", () => {
    const upfront = provenanceOf(
      quote({ sourceMethod: "partner_api", priceType: "UPFRONT_QUOTE" }),
    );
    const estimate = provenanceOf(quote({ sourceMethod: "partner_api", priceType: "ESTIMATE" }));
    expect(upfront.kind).toBe("PARTNER_UPFRONT");
    expect(estimate.kind).toBe("PARTNER_ESTIMATE");
    expect(upfront.label).not.toBe(estimate.label);
  });

  it("never marks a partner figure as modeled", () => {
    for (const method of ["partner_api", "authorized_direct", "licensed_aggregation"] as const) {
      expect(provenanceOf(quote({ sourceMethod: method })).modeled, method).toBe(false);
    }
  });

  it("labels a fixture as one", () => {
    expect(provenanceOf(quote({ sourceMethod: "fixture" })).kind).toBe("FIXTURE");
  });
});

describe("the decomposition is real", () => {
  /*
   * Driven by an actual computeProductFare result rather than a hand-written
   * metadata bag. A label map whose keys do not match the engine's renders an
   * empty breakdown — which would look like candour and show nothing — so the
   * engine has to be the one supplying the keys.
   */
  const fare = computeProductFare({
    product: "uberx",
    provider: "uber",
    // Midtown → JFK, which crosses a tolled river and the congestion zones.
    pickup: { lat: 40.7549, lng: -73.984 },
    destination: { lat: 40.6413, lng: -73.7781 },
    miles: 16.2,
    osrmMinutes: 38,
    now: new Date("2026-03-04T18:30:00Z"),
  });

  const real = quote({
    metadata: {
      city: fare.marketName,
      rateCardDollars: fare.rateCardDollars,
      feeBreakdown: fare.feeBreakdown,
      marketplaceFactors: fare.marketplaceFactors,
      trafficMinutes: fare.trafficMinutes,
      weatherSurgeLift: 1.15,
      weather: "rain:1.2mm",
    },
  });

  it("produces rows from a genuine computed fare", () => {
    const rows = provenanceRows(real);
    expect(rows.length).toBeGreaterThan(2);
    expect(rows[0]!.label).toBe("Rate card subtotal");
    expect(rows[0]!.value).toBe(fare.rateCardDollars);
  });

  it("names every fee the engine emitted rather than dropping it", () => {
    const rows = provenanceRows(real);
    const labels = rows.map((r) => r.label.toLowerCase());
    for (const key of Object.keys(fare.feeBreakdown)) {
      if (!fare.feeBreakdown[key]) continue;
      // Every non-zero fee has to appear somewhere, under a human label.
      const shown = rows.some(
        (r) =>
          r.kind !== "note" && typeof r.value === "number" && r.value === fare.feeBreakdown[key],
      );
      expect(shown, `${key} = ${fare.feeBreakdown[key]} was not shown`).toBe(true);
    }
    expect(labels.some((l) => l.includes("traffic"))).toBe(true);
  });

  it("marks the traffic figure as modeled rather than measured", () => {
    const traffic = provenanceRows(real).find((r) => r.label.includes("Traffic"));
    expect(traffic?.detail).toMatch(/modeled, not measured/);
  });

  it("shows the weather lift with its source", () => {
    const weather = provenanceRows(real).find((r) => r.label === "Weather lift");
    expect(weather?.kind).toBe("factor");
    expect(weather?.detail).toMatch(/Open-Meteo/);
  });

  it("stays silent for a source that supplied no arithmetic", () => {
    expect(provenanceRows(quote({ metadata: {} }))).toEqual([]);
  });

  it("does not print a multiplier of exactly 1", () => {
    const rows = provenanceRows(
      quote({ metadata: { marketplaceFactors: { multiplier: 1, tod_lift: 0.3 } } }),
    );
    expect(rows.filter((r) => r.kind === "factor")).toEqual([]);
  });

  /*
   * The signals that feed the multiplier are not multipliers on the fare.
   * Rendering tod_lift as a row printed "×0.28" beside the price, which reads
   * as a 72% discount. They belong in the detail line as evidence.
   */
  it("shows one multiplier, with its signals as evidence rather than rows", () => {
    const rows = provenanceRows(
      quote({
        metadata: {
          rateCardDollars: 40,
          marketplaceFactors: { multiplier: 1.08, tod_lift: 0.28, zone_heat: 0.25 },
        },
      }),
    );
    const factors = rows.filter((r) => r.kind === "factor");
    expect(factors).toHaveLength(1);
    expect(factors[0]!.label).toBe("Marketplace multiplier");
    expect(factors[0]!.value).toBe(1.08);
    expect(factors[0]!.detail).toMatch(/tod lift 0\.28/);
    expect(factors[0]!.detail).toMatch(/Simulated, not observed/);
  });

  /*
   * On a Manhattan-JFK trip the engine sets rateCardDollars to the flat fare
   * and also records nyc_jfk_flat at the same value. Listing both made a $70
   * fare read as $140 — a reader who checks the arithmetic gets a wrong answer
   * and no warning, which is worse than showing no breakdown.
   */
  it("never lists the subtotal twice", () => {
    const rows = provenanceRows(
      quote({
        metadata: {
          city: "New York, NY",
          rateCardDollars: 70,
          feeBreakdown: { nyc_jfk_flat: 70, mta_state_surcharge: 0.5 },
        },
      }),
    );
    const money = rows.filter((r) => r.kind === "money");
    expect(money.map((r) => r.value)).toEqual([70, 0.5]);
    // The flat fare survives as the subtotal's provenance.
    expect(money[0]!.detail).toMatch(/flat fare/i);
  });

  it("ends with the figure on the card, so the lines reconcile", () => {
    const rows = provenanceRows(
      quote({ metadata: { rateCardDollars: 40 }, priceMinMinor: 2400, priceMaxMinor: 2900 }),
    );
    const last = rows.at(-1)!;
    expect(last.kind).toBe("total");
    expect(last.value).toBe("$24.00 – $29.00");
  });

  /*
   * The total's value is a formatted band, not a number. The chip's formatter
   * coerced every non-note row to money and rendered "$NaN" on screen.
   */
  it("keeps text values as text so nothing renders as NaN", () => {
    const rows = provenanceRows(quote({ metadata: { rateCardDollars: 40, trafficMinutes: 33 } }));
    for (const row of rows) {
      if (typeof row.value !== "string") continue;
      expect(row.value).not.toMatch(/NaN/);
      expect(Number.isNaN(Number(row.value))).toBe(true);
    }
  });

  it("names the additive marketplace component on both fare paths", () => {
    for (const key of ["marketplace_rules", "marketplace_additive"]) {
      const rows = provenanceRows(
        quote({ metadata: { rateCardDollars: 40, feeBreakdown: { [key]: 2.61 } } }),
      );
      const row = rows.find((r) => r.value === 2.61);
      expect(row?.label, key).toBe("Marketplace rules");
    }
  });

  it("prints an exact figure without a phantom range", () => {
    const rows = provenanceRows(
      quote({ metadata: { rateCardDollars: 40 }, priceMinMinor: 2400, priceMaxMinor: 2400 }),
    );
    expect(rows.at(-1)!.value).toBe("$24.00");
  });
});

describe("the band note", () => {
  it("refuses to imply a midpoint for a range", () => {
    const note = bandNote(quote({ priceMinMinor: 2400, priceMaxMinor: 2900 }));
    expect(note).toMatch(/no midpoint is shown/);
  });

  it("says an exact modeled figure is still not a locked fare", () => {
    const note = bandNote(
      quote({ priceMinMinor: 2400, priceMaxMinor: 2400, sourceMethod: "public_rate_card" }),
    );
    expect(note).toMatch(/not a locked fare/);
  });
});

describe("how long until a car arrives", () => {
  const modeled = (over: Record<string, unknown> = {}) =>
    quote({
      metadata: {
        rateCardDollars: 40,
        waitLowSeconds: 120,
        waitHighSeconds: 240,
        waitDensity: "core",
        waitConfidence: "medium",
        ...over,
      },
      pickupEtaSeconds: 180,
    });

  it("says where the wait came from, because the fare sheet said nothing about it", () => {
    const rows = provenanceRows(modeled());
    const wait = rows.find((r) => r.label === "Pickup wait");
    expect(wait).toBeDefined();
    expect(wait!.value).toBe("2 to 4 min");
    expect(wait!.detail).toMatch(/dense city centre/i);
  });

  /*
   * The one that matters. A rider looking at "2 to 4 min" has no way to tell
   * it from a number a provider supplied, and this is the page they open to
   * ask.
   */
  it("states plainly that nobody was asked how far away a car is", () => {
    const rows = provenanceRows(modeled());
    const note = rows.find((r) => r.label === "Not a live ETA");
    expect(note).toBeDefined();
    expect(note!.detail).toMatch(/never been checked/i);
  });

  it("warns when there is barely any supply to model", () => {
    const rows = provenanceRows(modeled({ waitDensity: "sparse", waitConfidence: "low" }));
    expect(rows.find((r) => r.label === "Wait confidence")?.value).toBe("Low");
  });

  it("is quiet when the model is confident enough", () => {
    expect(provenanceRows(modeled()).find((r) => r.label === "Wait confidence")).toBeUndefined();
  });

  /*
   * A partner ETA is a real answer from a provider. Calling it modeled would
   * be a fresh lie pointing the other way.
   */
  it("never calls a partner's real ETA a model", () => {
    const partner = quote({
      source: "obi",
      metadata: { rateCardDollars: 40 },
      pickupEtaSeconds: 180,
    });
    expect(provenanceRows(partner).some((r) => r.label === "Not a live ETA")).toBe(false);
  });

  /* The sheet's claim is that its lines reconcile to the figure on the card. */
  it("leaves the total last", () => {
    const rows = provenanceRows(modeled());
    expect(rows.at(-1)!.kind).toBe("total");
  });

  it("adds nothing to a quote that had nothing to decompose", () => {
    expect(provenanceRows(quote({ metadata: {}, pickupEtaSeconds: 180 }))).toEqual([]);
  });
});
