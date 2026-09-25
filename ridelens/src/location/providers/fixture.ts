/**
 * Deterministic geocoder for tests and E2E only.
 *
 * loadConfig() throws if GEOCODER_PROVIDER=fixture is set with
 * NODE_ENV=production, so this cannot reach a production deployment.
 */
import type { CanonicalLocation, Geocoder, GeocoderCapabilities, PlaceSuggestion } from '../types';

const PLACES: CanonicalLocation[] = [
  {
    lat: 40.7233,
    lng: -73.9959,
    formattedAddress: '14 Prince St, New York, NY 10012, USA',
    placeId: 'fixture/prince-st',
    name: '14 Prince St',
    city: 'New York',
    region: 'NY',
    country: 'US',
    geocoder: 'fixture',
  },
  {
    lat: 40.644,
    lng: -73.7823,
    formattedAddress: 'JFK Airport Terminal 4, Jamaica, NY 11430, USA',
    placeId: 'fixture/jfk-t4',
    name: 'JFK Terminal 4',
    city: 'New York',
    region: 'NY',
    country: 'US',
    geocoder: 'fixture',
  },
  {
    lat: 40.7527,
    lng: -73.9772,
    formattedAddress: 'Grand Central Terminal, 89 E 42nd St, New York, NY 10017, USA',
    placeId: 'fixture/grand-central',
    name: 'Grand Central Terminal',
    city: 'New York',
    region: 'NY',
    country: 'US',
    geocoder: 'fixture',
  },
  {
    lat: 40.7061,
    lng: -73.9969,
    formattedAddress: '1 Brooklyn Bridge, Brooklyn, NY 11201, USA',
    placeId: 'fixture/brooklyn-bridge',
    name: 'Brooklyn Bridge',
    city: 'Brooklyn',
    region: 'NY',
    country: 'US',
    geocoder: 'fixture',
  },
  {
    lat: 40.758,
    lng: -73.9855,
    formattedAddress: 'Times Square, Manhattan, NY 10036, USA',
    placeId: 'fixture/times-square',
    name: 'Times Square',
    city: 'New York',
    region: 'NY',
    country: 'US',
    geocoder: 'fixture',
  },
];

export class FixtureGeocoder implements Geocoder {
  capabilities(): GeocoderCapabilities {
    return {
      id: 'fixture',
      supportsAutocomplete: true,
      supportsReverse: true,
      requiresApiKey: false,
      rateLimitPerSecond: 1000,
      attribution: null,
    };
  }

  async autocomplete(query: string): Promise<PlaceSuggestion[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return PLACES.filter(
      (p) => p.name.toLowerCase().includes(q) || p.formattedAddress.toLowerCase().includes(q),
    ).map((p) => ({
      id: `fixture:${p.placeId}`,
      primaryText: p.name,
      secondaryText: p.formattedAddress,
      kind: p.name.includes('JFK') ? ('AIRPORT' as const) : ('ADDRESS' as const),
      lat: p.lat,
      lng: p.lng,
    }));
  }

  async resolve(suggestionOrQuery: string): Promise<CanonicalLocation | null> {
    const token = suggestionOrQuery.startsWith('fixture:')
      ? suggestionOrQuery.slice('fixture:'.length)
      : null;
    if (token) return PLACES.find((p) => p.placeId === token) ?? null;
    const q = suggestionOrQuery.trim().toLowerCase();
    return (
      PLACES.find(
        (p) => p.name.toLowerCase().includes(q) || p.formattedAddress.toLowerCase().includes(q),
      ) ?? null
    );
  }

  async reverse(lat: number, lng: number): Promise<CanonicalLocation | null> {
    let best: CanonicalLocation | null = null;
    let bestD = Infinity;
    for (const p of PLACES) {
      const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }
}
