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
  tripFees,
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

  it("is deterministic within the same tick", () => {
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
