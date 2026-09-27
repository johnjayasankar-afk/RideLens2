import { describe, expect, it } from "vitest";
import {
  computeProductFare,
  inManhattanBelow60,
  inWestchester,
  uncertaintyBand,
} from "@/lib/sources/ratecard/fare-engine";
import {
  computeFareDollars,
  demandMultiplier,
  fareBand,
  nearestCity,
  tlcDriverMinimumDollars,
  tripFees,
  variableFareDollars,
} from "@/lib/sources/ratecard/rates";
import { formatPlaceLabel } from "@/lib/location/geocoder";

describe("public rate cards", () => {
  it("picks New York for lower Manhattan", () => {
    const m = nearestCity(40.7225, -73.9945);
    expect(m.id).toBe("new-york");
  });

  it("keeps NYC UberX bands tight for ~18mi / 45min off-peak", () => {
    const m = nearestCity(40.7225, -73.9945);
    const demand = demandMultiplier(new Date("2026-09-03T14:00:00"), m.city.surge);
    expect(demand.band).toBeLessThanOrEqual(0.03);

    const fees = tripFees(
      { lat: 40.7225, lng: -73.9945 },
      { lat: 40.6413, lng: -73.7781 },
      "new-york",
    );
    const center = computeFareDollars(m.city.uber, 17.8, 45, demand.center) + fees.addOnDollars;
    const { low, high } = fareBand(center, demand.band);

    expect(center).toBeGreaterThan(40);
    expect(center).toBeLessThan(85);
    expect(high / low).toBeLessThan(1.08);
  });

  it("applies Manhattan↔JFK taxi flat ~$70", () => {
    const fees = tripFees(
      { lat: 40.7225, lng: -73.9945 },
      { lat: 40.6413, lng: -73.7781 },
      "new-york",
    );
    expect(fees.nycJfkFlatTaxi).toBe(70);
  });
});

describe("fare engine — Scarsdale → Chelsea", () => {
  const pickup = { lat: 40.997305, lng: -73.7812948 };
  const destination = { lat: 40.7451293, lng: -74.0067795 };

  it("recognizes Westchester and below-60th Manhattan", () => {
    expect(inWestchester(pickup.lat, pickup.lng)).toBe(true);
    expect(inManhattanBelow60(destination.lat, destination.lng)).toBe(true);
  });

  it("prices UberX near Uber’s ~$70 corridor average with a tight band", () => {
    const fare = computeProductFare({
      product: "uberx",
      provider: "uber",
      pickup,
      destination,
      miles: 23.0,
      osrmMinutes: 44,
      now: new Date("2026-09-04T14:00:00"), // off-peak weekday
    });

    expect(fare.anchorId).toBe("westchester_to_manhattan");
    expect(fare.center).toBeGreaterThan(58);
    expect(fare.center).toBeLessThan(85);
    expect(fare.high - fare.low).toBeLessThan(8);
    expect(fare.high / fare.low).toBeLessThan(1.12);
    expect(fare.feeBreakdown.nys_congestion_below_96).toBe(2.75);
    expect(fare.feeBreakdown.mta_congestion_below_60).toBe(1.5);
  });

  it("keeps Lyft slightly under or near UberX", () => {
    const now = new Date("2026-09-04T14:00:00");
    const uber = computeProductFare({
      product: "uberx",
      provider: "uber",
      pickup,
      destination,
      miles: 23,
      osrmMinutes: 44,
      now,
    });
    const lyft = computeProductFare({
      product: "lyft",
      provider: "lyft",
      pickup,
      destination,
      miles: 23,
      osrmMinutes: 44,
      now,
    });
    expect(lyft.center).toBeLessThan(uber.center * 1.08);
    expect(lyft.high - lyft.low).toBeLessThan(8);
  });

  it("caps uncertainty at 4%", () => {
    expect(
      uncertaintyBand({
        miles: 30,
        isPeak: true,
        crossJurisdiction: true,
        hasAnchor: false,
        product: "empower",
      }),
    ).toBeLessThanOrEqual(0.04);
  });
});

describe("marketplace realtime dynamics", () => {
  const pickup = { lat: 40.7225, lng: -73.9945 };
  const destination = { lat: 40.6413, lng: -73.7781 };

  it("changes price across marketplace ticks", () => {
    const a = computeProductFare({
      product: "uberx",
      provider: "uber",
      pickup,
      destination,
      miles: 17.8,
      osrmMinutes: 42,
      now: new Date("2026-09-04T17:30:00.000Z"),
    });
    const b = computeProductFare({
      product: "uberx",
      provider: "uber",
      pickup,
      destination,
      miles: 17.8,
      osrmMinutes: 42,
      now: new Date("2026-09-04T17:31:10.000Z"),
    });
    expect(a.marketplaceTick).not.toBe(b.marketplaceTick);
    expect(a.center).not.toBe(b.center);
  });

  /*
   * This was called "is deterministic within the same tick" and passed the
   * same instant to both calls, so it could only ever prove that the
   * function is pure. It passed for a year while the multiplier swept a
   * full sine cycle inside every tick.
   *
   * The tick claim is asserted properly in fare-invariants.test.ts, against
   * two *different* instants inside one tick. This one keeps the narrower
   * property it actually checks, under a name that says so.
   */
  it("returns the same fare for the same instant", () => {
    const now = new Date("2026-09-04T17:30:12.000Z");
    const a = computeProductFare({
      product: "lyft",
      provider: "lyft",
      pickup,
      destination,
      miles: 17.8,
      osrmMinutes: 42,
      now,
    });
    const b = computeProductFare({
      product: "lyft",
      provider: "lyft",
      pickup,
      destination,
      miles: 17.8,
      osrmMinutes: 42,
      now,
    });
    expect(a.center).toBe(b.center);
    expect(a.demandCenter).toBe(b.demandCenter);
  });

  it("diverges Uber vs Lyft vs Empower at the same instant", () => {
    const now = new Date("2026-09-04T22:15:00");
    const uber = computeProductFare({
      product: "uberx",
      provider: "uber",
      pickup,
      destination,
      miles: 8,
      osrmMinutes: 28,
      now,
    });
    const lyft = computeProductFare({
      product: "lyft",
      provider: "lyft",
      pickup,
      destination,
      miles: 8,
      osrmMinutes: 28,
      now,
    });
    const empower = computeProductFare({
      product: "empower",
      provider: "empower",
      pickup,
      destination,
      miles: 8,
      osrmMinutes: 28,
      now,
    });
    const centers = new Set([uber.center, lyft.center, empower.center]);
    expect(centers.size).toBeGreaterThanOrEqual(2);
    // Obi: Empower ~30% under Uber/Lyft on average
    expect(empower.center).toBeLessThan(uber.center * 0.85);
  });

  it("prices evening peak higher than midday for UberX", () => {
    const midday = computeProductFare({
      product: "uberx",
      provider: "uber",
      pickup,
      destination,
      miles: 10,
      osrmMinutes: 32,
      now: new Date("2026-09-03T13:00:00"), // Thu midday
    });
    const evening = computeProductFare({
      product: "uberx",
      provider: "uber",
      pickup,
      destination,
      miles: 10,
      osrmMinutes: 32,
      now: new Date("2026-09-03T17:45:00"), // Thu evening
    });
    expect(evening.demandCenter).toBeGreaterThan(midday.demandCenter);
    expect(evening.center).toBeGreaterThan(midday.center * 0.98);
  });
});

describe("place labels", () => {
  it("formats street addresses cleanly", () => {
    const label = formatPlaceLabel({
      housenumber: "14",
      street: "Prince Street",
      city: "New York",
      state: "NY",
    });
    expect(label.primaryText).toBe("14 Prince Street");
    expect(label.secondaryText).toBe("New York, NY");
    expect(label.formattedAddress).toBe("14 Prince Street, New York, NY");
  });
});

describe("how a meter differs from a TNC", () => {
  const meterRates = {
    base: 3,
    perMile: 3.5,
    perMin: 0.7,
    booking: 0,
    meter: "taximeter" as const,
  };
  const tncRates = { base: 2.55, perMile: 1.75, perMin: 0.35, booking: 2.55 };

  /*
   * A taximeter charges $0.70 per unit, and a unit is a fifth of a mile
   * above 12 mph *or* sixty seconds at or below it. Never both for the same
   * moment. Summing them put an 8.6-mile Midtown→LGA run at $50.81 against
   * a meter reading of about $34.
   */
  it("charges a meter for distance or time, never both", () => {
    // 8.6 miles in 25 minutes is 20.6 mph — comfortably above the threshold,
    // so the meter reads distance units.
    expect(variableFareDollars(meterRates, 8.6, 25)).toBeCloseTo(30.1, 2);
    expect(variableFareDollars(meterRates, 8.6, 25)).not.toBeCloseTo(30.1 + 17.5, 2);
  });

  it("switches to time when the trip crawls", () => {
    // 5 miles in 45 minutes is 6.7 mph — below the threshold, so time wins.
    expect(variableFareDollars(meterRates, 5, 45)).toBeCloseTo(31.5, 2);
  });

  /*
   * The two rates meet exactly at 12 mph, which is what makes `max` the
   * faithful form rather than an approximation: $3.50/mile is $0.70 per
   * fifth of a mile, and that is the same money as $0.70/minute at 12 mph.
   */
  it("meets exactly at the threshold the tariff names", () => {
    const miles = 4;
    const minutesAt12mph = (miles / 12) * 60;
    expect(meterRates.perMile * miles).toBeCloseTo(meterRates.perMin * minutesAt12mph, 6);
    expect(variableFareDollars(meterRates, miles, minutesAt12mph)).toBeCloseTo(14, 6);
  });

  /* A TNC really does bill both at once, so nothing here changes for them. */
  it("still sums distance and time for a TNC", () => {
    expect(variableFareDollars(tncRates, 10, 20)).toBeCloseTo(1.75 * 10 + 0.35 * 20, 6);
  });

  it("never lets a meter read above the concurrent sum", () => {
    for (const [d, t] of [
      [1, 5],
      [8.6, 25],
      [5, 45],
      [30, 40],
      [0.2, 60],
    ]) {
      const metered = variableFareDollars(meterRates, d, t);
      const summed = meterRates.perMile * d + meterRates.perMin * t;
      expect(metered).toBeLessThanOrEqual(summed);
      expect(metered).toBeGreaterThan(0);
    }
  });
});

describe("the JFK flat fare", () => {
  const midtown = { lat: 40.7549, lng: -73.984 };
  const jfk = { lat: 40.6446, lng: -73.7797 };

  /*
   * The TLC flat fare is $70 *plus tolls and surcharges*. The fee stack used
   * to return early with addOnDollars: 0, so a JFK cab was quoted at the
   * bare $70 — several dollars under what it can legally cost.
   */
  it("adds the surcharges a metered trip would pay", () => {
    const fare = computeProductFare({
      product: "taxi",
      provider: "curb",
      pickup: midtown,
      destination: jfk,
      miles: 17.4,
      osrmMinutes: 42,
      now: new Date("2026-03-04T15:20:00.000Z"),
    });
    expect(fare.feeBreakdown.nyc_jfk_flat).toBe(70);
    expect(fare.center).toBeGreaterThan(70);
    /* The same surcharges a metered taxi pays, not a different set. */
    expect(fare.feeBreakdown.mta_state_surcharge).toBeDefined();
    expect(fare.feeBreakdown.nys_congestion_taxi).toBeDefined();
  });

  /* A published flat number: the only thing uncertain is which tolls apply. */
  it("stays tightly banded, because the fare itself is published", () => {
    const fare = computeProductFare({
      product: "taxi",
      provider: "curb",
      pickup: jfk,
      destination: midtown,
      miles: 17.4,
      osrmMinutes: 42,
      now: new Date("2026-03-04T15:20:00.000Z"),
    });
    expect(fare.high - fare.low).toBeLessThanOrEqual(2);
  });
});

describe("statutory amounts are not estimates", () => {
  const midtown = { lat: 40.7549, lng: -73.984 };
  const harlem = { lat: 40.8116, lng: -73.9465 };
  const fare = (iso: string) =>
    computeProductFare({
      product: "taxi",
      provider: "curb",
      pickup: midtown,
      destination: harlem,
      miles: 5.2,
      osrmMinutes: 18,
      now: new Date(iso),
    });

  /*
   * A modelled ±15c jitter, standing in for fees nobody has enumerated, was
   * applied to the metered taxi too — whose additive is entirely TLC rule.
   * It reported a published $2.50 peak surcharge as $2.46, and showed a bare
   * "-0.04" off-peak where the right answer is that there is no surcharge.
   */
  it("reports the TLC peak surcharge as the tariff writes it", () => {
    const peak = fare("2026-03-03T21:30:00.000Z"); // Tue 16:30 New York
    expect(peak.feeBreakdown.marketplace_rules).toBe(2.5);
  });

  it("reports the overnight surcharge exactly", () => {
    const night = fare("2026-03-04T01:30:00.000Z"); // Tue 20:30 New York
    expect(night.feeBreakdown.marketplace_rules).toBe(1);
  });

  it("adds nothing at all when no surcharge applies", () => {
    const off = fare("2026-03-03T15:20:00.000Z"); // Tue 10:20 New York
    expect(off.feeBreakdown.marketplace_rules ?? 0).toBe(0);
  });
});

describe("surge applies where the operators say it applies", () => {
  const uberx = { base: 2.55, perMile: 1.75, perMin: 0.35, booking: 2.55 };
  const withMinimum = { ...uberx, minimum: 12 };

  /*
   * Uber describes surge as "a multiplier to standard rates" and says its
   * service fee percentage does not change during surge; Lyft lists its
   * service fee as a "Flat amount that varies by region". Neither is a rate.
   * This used to multiply the whole subtotal, so a 3x surge charged 3x the
   * booking fee too.
   */
  it("never multiplies the booking fee", () => {
    for (const surge of [1, 1.5, 2, 3]) {
      const fare = computeFareDollars(uberx, 10, 25, surge);
      const rateDriven = uberx.base + uberx.perMile * 10 + uberx.perMin * 25;
      expect(fare).toBeCloseTo(rateDriven * surge + uberx.booking, 6);
    }
  });

  /* At parity the two formulations agree, so nothing moves off-peak. */
  it("changes nothing when the market is not surging", () => {
    const flat = computeFareDollars(uberx, 10, 25, 1);
    expect(flat).toBeCloseTo(uberx.base + 17.5 + 8.75 + uberx.booking, 6);
  });

  it("keeps the minimum a floor on the total, not on the surgeable part", () => {
    /* A trip far below the minimum still bills exactly the minimum. */
    expect(computeFareDollars(withMinimum, 0.1, 1, 1)).toBeCloseTo(12, 6);
    /* And the floor is not surged either — it is a minimum, not a rate. */
    expect(computeFareDollars(withMinimum, 0.1, 1, 2)).toBeCloseTo(
      (12 - withMinimum.booking) * 2 + withMinimum.booking,
      6,
    );
  });
});

describe("the floor New York law puts under a for-hire trip", () => {
  /*
   * The NYC card here priced a *passenger* below what the operator must pay
   * the *driver*: $35.80 of rate-driven fare on a 10-mile, 45-minute crawl
   * against a $43.48 driver minimum. Its per-minute rate is $0.35; the
   * regulated minimum is $0.681.
   *
   * The card's values are unverified and guessing better ones would only
   * swap their guess for mine. The driver minimum is published regulation,
   * and a platform takes a commission rather than paying a subsidy, so it
   * is usable as a floor without claiming to know the card.
   */
  it("computes the published minimum", () => {
    expect(tlcDriverMinimumDollars(10, 45)).toBeCloseTo(1.283 * 10 + 0.681 * 45, 6);
    expect(tlcDriverMinimumDollars(0, 0)).toBe(0);
  });

  it("treats nonsense distances as zero rather than negative money", () => {
    expect(tlcDriverMinimumDollars(-5, -5)).toBe(0);
  });

  it("lifts a fare that sits under it", () => {
    const card = { base: 2.55, perMile: 1.75, perMin: 0.35, booking: 2.55 };
    const floor = tlcDriverMinimumDollars(10, 45);
    const withFloor = computeFareDollars(card, 10, 45, 1, floor);
    const without = computeFareDollars(card, 10, 45, 1, 0);
    expect(without).toBeLessThan(withFloor);
    expect(withFloor).toBeCloseTo(floor + card.booking, 6);
  });

  /* Only a floor: where the card is already above it, nothing happens. */
  it("does nothing to a fare already above it", () => {
    const generous = { base: 10, perMile: 6, perMin: 2, booking: 2.55 };
    expect(computeFareDollars(generous, 10, 45, 1, tlcDriverMinimumDollars(10, 45))).toBeCloseTo(
      computeFareDollars(generous, 10, 45, 1, 0),
      6,
    );
  });

  /* It bounds the trip, not the demand on it, so surge applies after. */
  it("is applied before surge", () => {
    const card = { base: 2.55, perMile: 1.75, perMin: 0.35, booking: 2.55 };
    const floor = tlcDriverMinimumDollars(10, 45);
    expect(computeFareDollars(card, 10, 45, 2, floor)).toBeCloseTo(floor * 2 + card.booking, 6);
  });

  /*
   * It is a New York high-volume for-hire rule. The metered taxi is priced
   * under a different tariff, and Empower is not licensed as an HVFHS base.
   */
  it("does not reach the taxi or Empower", () => {
    const slow = { miles: 10, osrmMinutes: 45, now: new Date("2026-03-04T15:20:00.000Z") };
    const midtown = { lat: 40.7549, lng: -73.984 };
    const soho = { lat: 40.7225, lng: -73.9945 };
    for (const [product, provider] of [
      ["taxi", "curb"],
      ["empower", "empower"],
    ] as const) {
      const fare = computeProductFare({
        product,
        provider,
        pickup: midtown,
        destination: soho,
        ...slow,
      });
      expect(fare.feeBreakdown.tlc_driver_minimum).toBeUndefined();
    }
  });
});
