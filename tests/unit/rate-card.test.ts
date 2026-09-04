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
    const demand = demandMultiplier(
      new Date("2026-09-03T14:00:00"),
      m.city.surge,
    );
    expect(demand.band).toBeLessThanOrEqual(0.03);

    const fees = tripFees(
      { lat: 40.7225, lng: -73.9945 },
      { lat: 40.6413, lng: -73.7781 },
      "new-york",
    );
    const center =
      computeFareDollars(m.city.uber, 17.8, 45, demand.center) +
      fees.addOnDollars;
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
    expect(fare.center).toBeGreaterThan(62);
    expect(fare.center).toBeLessThan(78);
    expect(fare.high - fare.low).toBeLessThan(6);
    expect(fare.high / fare.low).toBeLessThan(1.09);
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
    expect(lyft.center).toBeLessThan(uber.center * 1.02);
    expect(lyft.high - lyft.low).toBeLessThan(6);
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
