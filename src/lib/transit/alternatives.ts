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
import type { MeasuredJourney } from "./journey-time";
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
 * The area these tariffs actually describe: the subway network itself.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT WAS WRONG                                                           │
 * │                                                                          │
 * │ This was a 22 km circle drawn around Midtown, and a circle drawn around  │
 * │ Manhattan reaches across the Hudson. Measured with this file's own       │
 * │ haversine: Hoboken 4.3 km, Jersey City 6.5 km, downtown Newark 16.0 km,  │
 * │ Tompkinsville on Staten Island 16.3 km, Yonkers 20.9 km — every one      │
 * │ inside the radius, and every one served the "AirTrain + subway $11.75"   │
 * │ row.                                                                     │
 * │                                                                          │
 * │ All five are false. Hoboken and Jersey City need PATH on top, Newark     │
 * │ needs PATH or NJ Transit, Yonkers is Metro-North at a distance-based     │
 * │ fare, and Staten Island has no subway at all. The product that widens a  │
 * │ band rather than overstate a fare was quoting a price for a journey that │
 * │ cannot be made at that price — a worse failure than the empty panel      │
 * │ beside it, and a quieter one, because a figure that is merely wrong      │
 * │ looks exactly like a figure that is right.                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the test is the network, not a distance. These bounds are deliberately
 * tight: they under-claim at the edges — a Brooklyn waterfront address west
 * of the line gets no row — because the failure directions are not equal.
 * Saying nothing is already this module's documented behaviour and is not a
 * claim that transit is unavailable. Saying $11.75 is a claim, and a wrong
 * one puts a number in front of a rider that no journey can honour.
 *
 * Replacing these with the publisher's own station positions would be
 * strictly better and is the right next step; it needs the MTA's station
 * dataset read and dated the way tariffs.ts reads a fare page, rather than
 * recalled.
 */
const SUBWAY_SERVED = {
  /* 40.92 is just north of the city line; Yonkers begins at 40.93. */
  latMin: 40.55,
  latMax: 40.92,
  /* Far Rockaway is the eastern end of the network. */
  lngMax: -73.7,
  /*
   * The Hudson, which moves west as it goes south. At Manhattan and Bronx
   * latitudes New Jersey begins around -74.02; south of that, Brooklyn's own
   * shore reaches -74.05 and Bayonne lies beyond it.
   */
  lngMinNorth: -74.02,
  lngMinSouth: -74.05,
  splitLat: 40.7,
} as const;

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

/** Is this point somewhere one subway fare can actually reach? */
export function subwayServed(point: Point): boolean {
  const { latMin, latMax, lngMax, lngMinNorth, lngMinSouth, splitLat } = SUBWAY_SERVED;
  if (point.lat < latMin || point.lat > latMax) return false;
  if (point.lng > lngMax) return false;
  return point.lng >= (point.lat >= splitLat ? lngMinNorth : lngMinSouth);
}

function toAlternative(tariff: TransitTariff, airportName: string): TransitAlternative {
  return {
    id: tariff.id,
    label: tariff.label,
    kind: "transit",
    fareMinor: tariffTotalMinor(tariff),
    durationSeconds: null,
    durationSource: null,
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
  /* No airport at either end: a trip inside the city is one flat fare. */
  if (!airport) return subwayAlternativeFor(pickup, destination);

  const other = fromAirport ? destination : pickup;
  if (!subwayServed(other)) return null;

  const tariff = TARIFFS[airport.tariffId];
  if (!tariff) return null;
  return toAlternative(tariff, airport.name);
}

/**
 * A trip that begins and ends on the subway network.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The panel answered "Is there a way without one?" with "RideLens has      │
 * │ nothing for this route" on any trip that was not an airport run — which  │
 * │ is most trips, and most of them are one subway ride. The fare was        │
 * │ already in the tree, sourced to mta.info and dated, and already treated  │
 * │ as covering an arbitrary city-wide journey by the airport tariffs that   │
 * │ bundle it.                                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The line this draws, precisely: the MTA's flat fare with free transfers is
 * a published rule, so "one fare" is a fact about the tariff and needs no
 * routing. Whether a sensible route exists between these two points, and how
 * long it takes, are facts about a schedule — and there is no schedule source
 * here, so both are stated as absent rather than estimated. Estimating a
 * subway time from road distance was considered and rejected: it is a
 * function of line topology, transfers and headway, and off-peak the wait
 * alone can exceed the whole drive.
 */
function subwayAlternativeFor(pickup: Point, destination: Point): TransitAlternative | null {
  if (!subwayServed(pickup) || !subwayServed(destination)) return null;
  const tariff = TARIFFS["nyc-subway"];
  if (!tariff) return null;
  return {
    id: tariff.id,
    label: tariff.label,
    kind: "transit",
    fareMinor: tariffTotalMinor(tariff),
    durationSeconds: null,
    durationSource: null,
    durationNote:
      "One fare, with free transfers. No schedule source is configured, so whether a " +
      "route connects these two points, and how long it would take, are not modeled here.",
    unmodeled: tariff.unmodeled,
    tariff,
    sources: tariff.legs.map((l) => ({ label: l.label, url: l.source, verifiedOn: l.verifiedOn })),
  };
}

/** A walk is worth offering only when it is actually walkable. */
export const WALKABLE_MAX_SECONDS = 25 * 60;

export function walkAlternative(
  seconds: number | null,
  measuredAt: string = new Date().toISOString(),
): TransitAlternative | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds > WALKABLE_MAX_SECONDS) return null;
  return {
    id: "walk",
    label: "Walk",
    kind: "walk",
    fareMinor: 0,
    durationSeconds: Math.round(seconds),
    durationNote: null,
    /*
     * The walk has always had a measured time and never said who measured it.
     * It came from the foot router the whole time — see routing/osrm.ts — and
     * the same rule that makes a transit time cite its engine applies here.
     */
    durationSource: {
      label: "OSRM foot routing (FOSSGIS)",
      url: "https://routing.openstreetmap.de/",
      measuredAt,
    },
    unmodeled: null,
    sources: [],
  };
}

/**
 * A measured journey time, folded into an alternative that did not have one.
 *
 * Pure, and null-in means unchanged-out: an alternative whose time nobody
 * could compute keeps the note explaining why. The note is cleared only when
 * a figure replaces it, because the note exists to explain an absence and
 * there is no longer one to explain.
 */
export function withJourneyTime(
  alternative: TransitAlternative,
  measured: MeasuredJourney | null,
): TransitAlternative {
  if (!measured) return alternative;
  return {
    ...alternative,
    durationSeconds: measured.seconds,
    durationNote: null,
    durationSource: {
      label: measured.label,
      url: measured.url,
      measuredAt: measured.measuredAt,
    },
  };
}
