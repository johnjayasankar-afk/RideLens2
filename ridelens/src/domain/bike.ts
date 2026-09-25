/**
 * Bike-share trip modelling.
 *
 * A bike quote is only honest if the trip is actually possible, so this refuses
 * to price one unless it can point at a specific station with a bike right now
 * and a specific station with a dock right now. "There is bike-share in this
 * city" is not a quote.
 */
import { distanceMeters, type Point } from './geo';

export interface StationLike {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bikesAvailable: number;
  ebikesAvailable: number;
  docksAvailable: number;
  renting: boolean;
  returning: boolean;
}

/** Beyond this, walking to the bike defeats the point. */
export const MAX_WALK_METERS = 700;
/** Beyond this, a shared bike stops being a sensible way to make the trip. */
export const MAX_BIKE_METERS = 12_000;
/** Brisk urban walking. Used only to state a walk time, never a price. */
export const WALK_MPS = 1.35;
/**
 * Average door-to-door speed on a shared city bike, including junctions.
 * Deliberately conservative: a slower assumption widens the time band rather
 * than understating the fare.
 */
export const BIKE_SPEED_KMH_LOW = 11;
export const BIKE_SPEED_KMH_HIGH = 16;

/**
 * Which vehicle a published plan actually prices.
 *
 * This matters more than it looks. Citi Bike, for one, publishes a single
 * pricing plan and it is the e-bike one — so a quote built from that plan is an
 * e-bike price, and it is only true if an e-bike is really in the rack. A
 * station holding thirteen classic bikes and no e-bike satisfies "has a bike"
 * and still cannot deliver the trip we quoted.
 */
export type BikeVehicle = 'EBIKE' | 'CLASSIC' | 'ANY';

export const VEHICLE_LABEL: Record<BikeVehicle, string> = {
  EBIKE: 'e-bike',
  CLASSIC: 'classic bike',
  ANY: 'bike',
};

/** "an e-bike", "a classic bike" — prose that reads like a person wrote it. */
export const VEHICLE_ARTICLE: Record<BikeVehicle, string> = {
  EBIKE: 'an',
  CLASSIC: 'a',
  ANY: 'a',
};

/**
 * How many of `vehicle` this station has right now.
 *
 * GBFS `num_bikes_available` is the **total** available and `num_ebikes_available`
 * is a subset of it, not a separate pool — Citi Bike reporting 13 and 1 means
 * twelve classic bikes and one e-bike, thirteen vehicles. Adding the two
 * double-counts every e-bike.
 *
 * A feed reporting more e-bikes than vehicles is plainly using the other
 * convention, so the two are read as disjoint there. Guessing wrong in that
 * direction only ever understates supply, which costs a quote rather than
 * sending someone to an empty rack.
 */
export function availableOf(station: StationLike, vehicle: BikeVehicle): number {
  const total = Math.max(0, station.bikesAvailable);
  const ebikes = Math.max(0, station.ebikesAvailable);
  const nested = ebikes <= total;
  if (vehicle === 'EBIKE') return ebikes;
  if (vehicle === 'CLASSIC') return nested ? total - ebikes : total;
  return nested ? total : total + ebikes;
}

export interface StationPick {
  station: StationLike;
  walkMeters: number;
  walkSeconds: number;
}

export function nearestWithBike(
  from: Point,
  stations: StationLike[],
  vehicle: BikeVehicle = 'ANY',
): StationPick | null {
  return nearest(
    from,
    stations.filter((s) => s.renting && availableOf(s, vehicle) > 0),
  );
}

export function nearestWithDock(to: Point, stations: StationLike[]): StationPick | null {
  return nearest(
    to,
    stations.filter((s) => s.returning && s.docksAvailable > 0),
  );
}

function nearest(point: Point, candidates: StationLike[]): StationPick | null {
  let best: StationPick | null = null;
  for (const station of candidates) {
    const walkMeters = distanceMeters(point, station);
    if (walkMeters > MAX_WALK_METERS) continue;
    if (!best || walkMeters < best.walkMeters) {
      best = { station, walkMeters, walkSeconds: Math.round(walkMeters / WALK_MPS) };
    }
  }
  return best;
}

export interface BikeTrip {
  /** The vehicle this trip is priced for; start-station supply matches it. */
  vehicle: BikeVehicle;
  start: StationPick;
  end: StationPick;
  rideMeters: number;
  /** Fastest plausible ride, in seconds. */
  rideSecondsLow: number;
  /** Slowest plausible ride, in seconds. */
  rideSecondsHigh: number;
  totalSecondsLow: number;
  totalSecondsHigh: number;
}

/**
 * Builds a concrete trip, or returns null with a reason the UI can show.
 * `rideMeters` should be a routed distance where available; the straight line
 * would understate a real ride and therefore the fare.
 */
export function planBikeTrip(args: {
  pickup: Point;
  destination: Point;
  rideMeters: number;
  stations: StationLike[];
  /** The vehicle the chosen pricing plan covers. Defaults to any. */
  vehicle?: BikeVehicle;
}): { trip: BikeTrip } | { reason: string } {
  if (args.rideMeters > MAX_BIKE_METERS) {
    return {
      reason: `That trip is about ${Math.round(args.rideMeters / 1000)} km, too far for a shared bike.`,
    };
  }

  const vehicle = args.vehicle ?? 'ANY';
  const start = nearestWithBike(args.pickup, args.stations, vehicle);
  if (!start) {
    return {
      reason: `No station with a ${VEHICLE_LABEL[vehicle]} available within a short walk of the pickup.`,
    };
  }
  const end = nearestWithDock(args.destination, args.stations);
  if (!end) {
    return { reason: 'No station with a free dock within a short walk of the destination.' };
  }
  if (start.station.id === end.station.id) {
    return { reason: 'Pickup and destination share the same station.' };
  }

  const km = args.rideMeters / 1000;
  const rideSecondsHigh = Math.round((km / BIKE_SPEED_KMH_LOW) * 3600);
  const rideSecondsLow = Math.round((km / BIKE_SPEED_KMH_HIGH) * 3600);

  return {
    trip: {
      vehicle,
      start,
      end,
      rideMeters: args.rideMeters,
      rideSecondsLow,
      rideSecondsHigh,
      totalSecondsLow: start.walkSeconds + rideSecondsLow + end.walkSeconds,
      totalSecondsHigh: start.walkSeconds + rideSecondsHigh + end.walkSeconds,
    },
  };
}

export interface BikeFare {
  minMinor: number;
  maxMinor: number;
  currency: string;
  planName: string;
  breakdown: string;
}

/**
 * Price a trip from a published plan.
 *
 * The band comes from ride duration, not from any doubt about the rate: the
 * unlock fee and per-minute price are published figures. Riding time is what
 * varies, so a slow ride costs more — exactly as it would in practice.
 */
export function priceBikeTrip(
  trip: BikeTrip,
  plan: { unlockMinor: number; perMinuteMinor: number | null; currency: string; name: string },
): BikeFare {
  const minutesLow = Math.ceil(trip.rideSecondsLow / 60);
  const minutesHigh = Math.ceil(trip.rideSecondsHigh / 60);
  const perMinute = plan.perMinuteMinor ?? 0;

  const minMinor = plan.unlockMinor + minutesLow * perMinute;
  const maxMinor = plan.unlockMinor + minutesHigh * perMinute;

  const breakdown =
    perMinute > 0
      ? `Unlock $${(plan.unlockMinor / 100).toFixed(2)} · ${minutesLow}–${minutesHigh} min at $${(perMinute / 100).toFixed(2)}/min`
      : `Unlock $${(plan.unlockMinor / 100).toFixed(2)}`;

  return { minMinor, maxMinor, currency: plan.currency, planName: plan.name, breakdown };
}
