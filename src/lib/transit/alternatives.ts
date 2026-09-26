/**
 * Building the "or you could take the train" row.
 *
 * Only fires where a published tariff genuinely covers the trip. There is no
 * general NYC transit fare model here and this does not pretend to be one:
 * an airport run has a single published door-to-rail price, and a trip from
 * one arbitrary corner of Brooklyn to another does not.
 *
 * Where nothing applies, this returns nothing. A row saying "transit: we
 * don't know" on every comparison would be noise; the absence of a row on a
 * cross-town trip is not a claim that transit is unavailable, and the copy
 * on the row that does appear never implies otherwise.
 */

import { TARIFFS, tariffTotalMinor, type TransitTariff } from "./tariffs";
import type { TransitAlternative } from "./types";

export interface Point {
  lat: number;
  lng: number;
}

interface Airport {
  code: "JFK" | "LGA" | "EWR";
  name: string;
  at: Point;
  /** Kilometres within which a point counts as "at the airport". */
  radiusKm: number;
  tariffId: keyof typeof TARIFFS;
}

/*
 * Airport centroids and a radius that covers the terminal area without
 * swallowing the neighbourhoods around it. JFK's is larger because the
 * airport is.
 */
const AIRPORTS: Airport[] = [
  {
    code: "JFK",
    name: "JFK",
    at: { lat: 40.6413, lng: -73.7781 },
    radiusKm: 3.0,
    tariffId: "jfk-subway",
  },
  {
    code: "LGA",
    name: "LaGuardia",
    at: { lat: 40.7769, lng: -73.874 },
    radiusKm: 2.2,
    tariffId: "lga-q70",
  },
  {
    code: "EWR",
    name: "Newark",
    at: { lat: 40.6895, lng: -74.1745 },
    radiusKm: 2.8,
    tariffId: "ewr-airtrain",
  },
];

/**
 * The area these tariffs actually describe: a rail journey into the city.
 *
 * An AirTrain-plus-subway fare is the price of getting from the airport to
 * the subway network. It does not describe JFK to Montauk, and quoting it
 * for one would be worse than saying nothing.
 */
const CITY_CENTRE: Point = { lat: 40.7549, lng: -73.984 };
const CITY_RADIUS_KM = 22;

export function haversineKm(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function airportAt(point: Point): Airport | null {
  for (const a of AIRPORTS) {
    if (haversineKm(point, a.at) <= a.radiusKm) return a;
  }
  return null;
}

function withinCity(point: Point): boolean {
  return haversineKm(point, CITY_CENTRE) <= CITY_RADIUS_KM;
}

function toAlternative(tariff: TransitTariff, airportName: string): TransitAlternative {
  return {
    id: tariff.id,
    label: tariff.label,
    kind: "transit",
    fareMinor: tariffTotalMinor(tariff),
    durationSeconds: null,
    durationNote: `Fare only. No schedule source is configured, so the journey time from ${airportName} is not modeled here.`,
    unmodeled: tariff.unmodeled,
    tariff,
    sources: tariff.legs.map((l) => ({
      label: l.label,
      url: l.source,
      verifiedOn: l.verifiedOn,
    })),
  };
}

/**
 * The transit alternative for a trip, if a published tariff covers it.
 *
 * Symmetric: an airport at either end is the same journey at the same price.
 */
export function transitAlternativeFor(
  pickup: Point,
  destination: Point,
): TransitAlternative | null {
  const fromAirport = airportAt(pickup);
  const toAirport = airportAt(destination);

  // Terminal to terminal is not a journey these tariffs describe.
  if (fromAirport && toAirport) return null;

  const airport = fromAirport ?? toAirport;
  if (!airport) return null;

  const other = fromAirport ? destination : pickup;
  if (!withinCity(other)) return null;

  const tariff = TARIFFS[airport.tariffId];
  if (!tariff) return null;
  return toAlternative(tariff, airport.name);
}

/** A walk is worth offering only when it is actually walkable. */
export const WALKABLE_MAX_SECONDS = 25 * 60;

export function walkAlternative(seconds: number | null): TransitAlternative | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds > WALKABLE_MAX_SECONDS) return null;
  return {
    id: "walk",
    label: "Walk",
    kind: "walk",
    fareMinor: 0,
    durationSeconds: Math.round(seconds),
    durationNote: null,
    unmodeled: null,
    sources: [],
  };
}
