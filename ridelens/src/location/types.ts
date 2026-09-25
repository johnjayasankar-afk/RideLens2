/**
 * One canonical location per endpoint, resolved once, reused by every source.
 *
 * This is the single most important correctness guarantee in the comparison:
 * if Uber prices a pickup 80 m from Lyft's, the fares are not comparable and
 * every downstream ranking is quietly wrong. We geocode ONCE and hand the same
 * coordinates to every adapter.
 */
export interface CanonicalLocation {
  lat: number;
  lng: number;
  formattedAddress: string;
  /** Stable id from the geocoding provider, when it issues one. */
  placeId: string | null;
  /** Short human label — "JFK Terminal 4", "Home". */
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  /** Which geocoder produced this, for provenance in the session record. */
  geocoder: string;
}

export interface PlaceSuggestion {
  /** Opaque token resolved back to a CanonicalLocation by the geocoder. */
  id: string;
  /** Primary line — the venue or street. */
  primaryText: string;
  /** Secondary line — city, region. */
  secondaryText: string;
  kind: 'AIRPORT' | 'VENUE' | 'ADDRESS' | 'LANDMARK' | 'CITY' | 'OTHER';
  /** Present when the provider returns coordinates with the suggestion. */
  lat: number | null;
  lng: number | null;
}

export interface GeocoderCapabilities {
  id: string;
  supportsAutocomplete: boolean;
  supportsReverse: boolean;
  requiresApiKey: boolean;
  /** Requests per second the provider's policy permits. */
  rateLimitPerSecond: number;
  attribution: string | null;
}

export interface Geocoder {
  capabilities(): GeocoderCapabilities;
  autocomplete(query: string, bias?: { lat: number; lng: number }): Promise<PlaceSuggestion[]>;
  /** Turn a suggestion (or free text) into the one canonical location. */
  resolve(
    suggestionOrQuery: string,
    hint?: { lat: number; lng: number },
  ): Promise<CanonicalLocation | null>;
  reverse(lat: number, lng: number): Promise<CanonicalLocation | null>;
}

export class GeocoderError extends Error {
  constructor(
    message: string,
    readonly code: 'UPSTREAM' | 'RATE_LIMITED' | 'NOT_FOUND' | 'CONFIG',
  ) {
    super(message);
    this.name = 'GeocoderError';
  }
}

/** Coordinates are only ever logged rounded to ~1 km. See docs/SECURITY.md. */
export function coarsen(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
