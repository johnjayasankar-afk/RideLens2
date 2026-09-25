/**
 * How far a rate card may travel.
 *
 * `nearestCity` returned the closest of 49 city centres with no distance cap
 * and a default of "new-york", so a query from Billings, Montana received Salt
 * Lake City's card — 622 km away — at full displayed confidence. Fargo got
 * Minneapolis from 345 km, Bangor got Boston from 328 km, and Kauai got
 * Honolulu from another island.
 */
import { describe, expect, it } from "vitest";

import {
  CALIBRATED_RADIUS_KM,
  EXTRAPOLATION_LIMIT_KM,
  nearestCity,
  resolveMarket,
} from "@/lib/sources/ratecard/rates";

const CITY = { lat: 40.7128, lng: -74.006 }; // New York
const BILLINGS = { lat: 45.7833, lng: -108.5007 };
const FARGO = { lat: 46.8772, lng: -96.7898 };

describe("resolveMarket", () => {
  it("uses a city's own card inside the calibrated radius", () => {
    const m = resolveMarket(CITY.lat, CITY.lng);
    expect(m.basis).toBe("CALIBRATED");
    expect(m.id).toBe("new-york");
    expect(m.distanceKm).toBeLessThan(CALIBRATED_RADIUS_KM);
  });

  it("still calibrates across a metro's suburbs", () => {
    // Scarsdale, ~30 km from the New York centre and squarely inside its fares.
    const m = resolveMarket(41.0051, -73.7846);
    expect(m.basis).toBe("CALIBRATED");
    expect(m.id).toBe("new-york");
  });

  /*
   * The case that motivated the cap. 622 km is not a suburb of Salt Lake City,
   * and the old code presented its card as an ordinary estimate.
   */
  it("refuses to price from a card 600 km away", () => {
    const m = resolveMarket(BILLINGS.lat, BILLINGS.lng);
    expect(m.basis).toBe("UNCOVERED");
    expect(m.distanceKm).toBeGreaterThan(EXTRAPOLATION_LIMIT_KM);
    // The nearest market is still named, so the refusal can say what it is.
    expect(m.id.length).toBeGreaterThan(0);
    expect(m.city.name.length).toBeGreaterThan(0);
  });

  it("refuses Fargo too, rather than borrowing Minneapolis", () => {
    const m = resolveMarket(FARGO.lat, FARGO.lng);
    expect(m.basis).toBe("UNCOVERED");
    expect(m.id).toBe("minneapolis");
  });

  it("marks the middle distance as borrowed rather than calibrated", () => {
    // Walk outward from New York until the basis changes, and check the
    // boundaries land where the constants say they do.
    const justOutside = resolveMarket(CITY.lat + CALIBRATED_RADIUS_KM / 111 + 0.05, CITY.lng);
    expect(justOutside.basis).toBe("EXTRAPOLATED");
    expect(justOutside.distanceKm).toBeGreaterThan(CALIBRATED_RADIUS_KM);
    expect(justOutside.distanceKm).toBeLessThanOrEqual(EXTRAPOLATION_LIMIT_KM);
  });

  it("keeps the two radii in a sane order", () => {
    expect(CALIBRATED_RADIUS_KM).toBeGreaterThan(0);
    expect(EXTRAPOLATION_LIMIT_KM).toBeGreaterThan(CALIBRATED_RADIUS_KM);
  });

  /*
   * nearestCity is still used for fee lookup and still defaults to New York on
   * an empty table. resolveMarket is the one that decides whether to trust it,
   * and that separation is the point — the distance no longer gets discarded.
   */
  it("agrees with nearestCity about which market is closest", () => {
    for (const p of [CITY, BILLINGS, FARGO]) {
      expect(resolveMarket(p.lat, p.lng).id).toBe(nearestCity(p.lat, p.lng).id);
    }
  });
});
