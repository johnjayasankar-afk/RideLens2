/**
 * Google Maps Platform geocoder (Places Autocomplete + Place Details + Geocoding).
 *
 * Activated when LOCATION_PROVIDER_API_KEY holds a Google key. Preferred for
 * consumer scale: far better venue/airport coverage and no courtesy rate cap.
 * Requires the Places API and Geocoding API to be enabled on the key.
 */
import { httpJson } from '@/sources/http';
import {
  GeocoderError,
  type CanonicalLocation,
  type Geocoder,
  type GeocoderCapabilities,
  type PlaceSuggestion,
} from '../types';

const HOST = 'maps.googleapis.com';
const TIMEOUT_MS = 5_000;

interface GAutocomplete {
  status?: string;
  predictions?: Array<{
    place_id?: string;
    description?: string;
    types?: string[];
    structured_formatting?: { main_text?: string; secondary_text?: string };
  }>;
}

interface GPlaceResult {
  status?: string;
  result?: GGeometryResult;
  results?: GGeometryResult[];
}

interface GGeometryResult {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  types?: string[];
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>;
}

export class GoogleGeocoder implements Geocoder {
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new GeocoderError('Google geocoder requires an API key', 'CONFIG');
  }

  capabilities(): GeocoderCapabilities {
    return {
      id: 'google',
      supportsAutocomplete: true,
      supportsReverse: true,
      requiresApiKey: true,
      rateLimitPerSecond: 50,
      attribution: 'Powered by Google',
    };
  }

  async autocomplete(
    query: string,
    bias?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]> {
    if (query.trim().length < 2) return [];
    const url = new URL(`https://${HOST}/maps/api/place/autocomplete/json`);
    url.searchParams.set('input', query.trim());
    url.searchParams.set('key', this.apiKey);
    if (bias) {
      url.searchParams.set('location', `${bias.lat},${bias.lng}`);
      url.searchParams.set('radius', '50000');
    }

    const data = await httpJson<GAutocomplete>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [HOST],
    });
    if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new GeocoderError(`Google autocomplete: ${data.status}`, 'UPSTREAM');
    }

    return (data.predictions ?? []).flatMap((p) => {
      if (!p.place_id) return [];
      return [
        {
          id: `google:${p.place_id}`,
          primaryText: p.structured_formatting?.main_text ?? p.description ?? '',
          secondaryText: p.structured_formatting?.secondary_text ?? '',
          kind: classify(p.types ?? []),
          lat: null,
          lng: null,
        } satisfies PlaceSuggestion,
      ];
    });
  }

  async resolve(suggestionOrQuery: string): Promise<CanonicalLocation | null> {
    if (suggestionOrQuery.startsWith('google:')) {
      const placeId = suggestionOrQuery.slice('google:'.length);
      const url = new URL(`https://${HOST}/maps/api/place/details/json`);
      url.searchParams.set('place_id', placeId);
      url.searchParams.set(
        'fields',
        'place_id,name,formatted_address,geometry,address_component,type',
      );
      url.searchParams.set('key', this.apiKey);
      const data = await httpJson<GPlaceResult>(url.toString(), {
        timeoutMs: TIMEOUT_MS,
        allowedHosts: [HOST],
      });
      return data.result ? toCanonical(data.result) : null;
    }

    const url = new URL(`https://${HOST}/maps/api/geocode/json`);
    url.searchParams.set('address', suggestionOrQuery);
    url.searchParams.set('key', this.apiKey);
    const data = await httpJson<GPlaceResult>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [HOST],
    });
    const first = data.results?.[0];
    return first ? toCanonical(first) : null;
  }

  async reverse(lat: number, lng: number): Promise<CanonicalLocation | null> {
    const url = new URL(`https://${HOST}/maps/api/geocode/json`);
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('key', this.apiKey);
    const data = await httpJson<GPlaceResult>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [HOST],
    });
    const first = data.results?.[0];
    return first ? toCanonical(first) : null;
  }
}

function classify(types: string[]): PlaceSuggestion['kind'] {
  if (types.includes('airport')) return 'AIRPORT';
  if (types.includes('point_of_interest') || types.includes('establishment')) return 'VENUE';
  if (types.includes('tourist_attraction')) return 'LANDMARK';
  if (types.includes('locality')) return 'CITY';
  if (types.includes('street_address') || types.includes('premise')) return 'ADDRESS';
  return 'OTHER';
}

function component(r: GGeometryResult, type: string): string | null {
  const c = (r.address_components ?? []).find((x) => (x.types ?? []).includes(type));
  return c?.short_name ?? c?.long_name ?? null;
}

function toCanonical(r: GGeometryResult): CanonicalLocation {
  const lat = r.geometry?.location?.lat;
  const lng = r.geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new GeocoderError('Google returned no coordinates', 'UPSTREAM');
  }
  const address = r.formatted_address ?? r.name ?? '';
  return {
    lat,
    lng,
    formattedAddress: address,
    placeId: r.place_id ?? null,
    name: r.name ?? address.split(',')[0] ?? address,
    city: component(r, 'locality') ?? component(r, 'postal_town') ?? null,
    region: component(r, 'administrative_area_level_1'),
    country: component(r, 'country'),
    geocoder: 'google',
  };
}
