/**
 * Route canonicalisation: turn whatever the client sent into exactly one
 * pickup and one destination, then hand the identical pair to every source.
 */
import { z } from 'zod';
import { getGeocoder } from './geocoder';
import { haversineMeters, type CanonicalLocation } from './types';

export const LocationInputSchema = z.union([
  z.object({
    kind: z.literal('coords'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('suggestion'),
    id: z.string().min(1).max(500),
  }),
  z.object({
    kind: z.literal('query'),
    text: z.string().min(2).max(300),
  }),
]);
export type LocationInput = z.infer<typeof LocationInputSchema>;

export class RouteError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'PICKUP_UNRESOLVED'
      | 'DESTINATION_UNRESOLVED'
      | 'SAME_POINT'
      | 'TOO_FAR'
      | 'CROSS_COUNTRY',
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

/** Beyond this a ride-hail comparison is meaningless; providers will not quote. */
const MAX_ROUTE_METERS = 500_000;
/** Below this the two endpoints are effectively the same place. */
const MIN_ROUTE_METERS = 50;

export async function resolveLocation(
  input: LocationInput,
  hint?: { lat: number; lng: number },
): Promise<CanonicalLocation | null> {
  const geocoder = getGeocoder();

  if (input.kind === 'coords') {
    const reversed = await geocoder.reverse(input.lat, input.lng);
    if (reversed) {
      // Trust the caller's precise coordinates; use the geocoder only for labels.
      return {
        ...reversed,
        lat: input.lat,
        lng: input.lng,
        name: input.label ?? reversed.name,
      };
    }
    return {
      lat: input.lat,
      lng: input.lng,
      formattedAddress: input.label ?? 'Current location',
      placeId: null,
      name: input.label ?? 'Current location',
      city: null,
      region: null,
      country: null,
      geocoder: geocoder.capabilities().id,
    };
  }

  const token = input.kind === 'suggestion' ? input.id : input.text;
  return geocoder.resolve(token, hint);
}

export interface CanonicalRoute {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  straightLineMeters: number;
}

export async function canonicalizeRoute(
  pickupInput: LocationInput,
  destinationInput: LocationInput,
): Promise<CanonicalRoute> {
  // Pickup first, so it can bias the destination lookup toward the same city.
  const pickup = await resolveLocation(pickupInput);
  if (!pickup) throw new RouteError('Could not resolve the pickup location.', 'PICKUP_UNRESOLVED');

  const destination = await resolveLocation(destinationInput, { lat: pickup.lat, lng: pickup.lng });
  if (!destination) {
    throw new RouteError('Could not resolve the destination.', 'DESTINATION_UNRESOLVED');
  }

  const straightLineMeters = haversineMeters(pickup, destination);
  if (straightLineMeters < MIN_ROUTE_METERS) {
    throw new RouteError('Pickup and destination are the same place.', 'SAME_POINT');
  }

  /**
   * Name what was actually resolved. A place name is often ambiguous — "Eiffel
   * Tower Paris" can land in Paris, Tennessee — and a bare "too far" leaves the
   * rider with no way to see that the geocoder chose the wrong one.
   */
  const resolved = `Resolved "${pickup.name}" → "${destination.name}". Pick a different suggestion if that is not what you meant.`;

  if (straightLineMeters > MAX_ROUTE_METERS) {
    throw new RouteError(
      `That route is ${Math.round(straightLineMeters / 1000)} km, too long for a ride-hail comparison. ${resolved}`,
      'TOO_FAR',
    );
  }
  if (pickup.country && destination.country && pickup.country !== destination.country) {
    throw new RouteError(`Cross-border routes are not supported. ${resolved}`, 'CROSS_COUNTRY');
  }

  return { pickup, destination, straightLineMeters };
}
