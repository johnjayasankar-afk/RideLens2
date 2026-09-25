/**
 * Mapbox Search Box geocoder. Activated when LOCATION_PROVIDER_API_KEY holds a
 * Mapbox token (pk.*). Comparable coverage to Google at lower cost in most tiers.
 */
import { httpJson } from '@/sources/http';
import {
  GeocoderError,
  type CanonicalLocation,
  type Geocoder,
  type GeocoderCapabilities,
  type PlaceSuggestion,
} from '../types';

const HOST = 'api.mapbox.com';
const TIMEOUT_MS = 5_000;

interface MbFeature {
  id?: string;
  place_name?: string;
  text?: string;
  place_type?: string[];
  center?: [number, number];
  context?: Array<{ id?: string; text?: string; short_code?: string }>;
  properties?: { category?: string };
}

export class MapboxGeocoder implements Geocoder {
  constructor(private readonly token: string) {
    if (!token) throw new GeocoderError('Mapbox geocoder requires a token', 'CONFIG');
  }

  capabilities(): GeocoderCapabilities {
    return {
      id: 'mapbox',
      supportsAutocomplete: true,
      supportsReverse: true,
      requiresApiKey: true,
      rateLimitPerSecond: 10,
      attribution: '© Mapbox © OpenStreetMap',
    };
  }

  private async forward(query: string, bias?: { lat: number; lng: number }, limit = 7) {
    const url = new URL(
      `https://${HOST}/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
    );
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('types', 'poi,address,place,postcode,neighborhood');
    if (bias) url.searchParams.set('proximity', `${bias.lng},${bias.lat}`);
    return httpJson<{ features?: MbFeature[] }>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [HOST],
    });
  }

  async autocomplete(
    query: string,
    bias?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]> {
    if (query.trim().length < 2) return [];
    const data = await this.forward(query.trim(), bias);
    return (data.features ?? []).flatMap((f) => {
      const center = f.center;
      if (!Array.isArray(center)) return [];
      const [lng, lat] = center;
      const parts = (f.place_name ?? '').split(', ');
      return [
        {
          id: `mapbox:${lat},${lng}|${f.text ?? ''}`,
          primaryText: f.text ?? parts[0] ?? '',
          secondaryText: parts.slice(1).join(', '),
          kind: classify(f),
          lat,
          lng,
        } satisfies PlaceSuggestion,
      ];
    });
  }

  async resolve(
    suggestionOrQuery: string,
    hint?: { lat: number; lng: number },
  ): Promise<CanonicalLocation | null> {
    if (suggestionOrQuery.startsWith('mapbox:')) {
      const [coords, label = ''] = suggestionOrQuery.slice('mapbox:'.length).split('|');
      const [latText, lngText] = (coords ?? '').split(',');
      const lat = Number(latText);
      const lng = Number(lngText);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const rev = await this.reverse(lat, lng);
        if (rev) return { ...rev, name: label || rev.name };
      }
    }
    const data = await this.forward(suggestionOrQuery, hint, 1);
    const first = data.features?.[0];
    return first ? toCanonical(first) : null;
  }

  async reverse(lat: number, lng: number): Promise<CanonicalLocation | null> {
    const url = new URL(`https://${HOST}/geocoding/v5/mapbox.places/${lng},${lat}.json`);
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('limit', '1');
    const data = await httpJson<{ features?: MbFeature[] }>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [HOST],
    });
    const first = data.features?.[0];
    return first ? toCanonical(first) : null;
  }
}

function classify(f: MbFeature): PlaceSuggestion['kind'] {
  const cat = f.properties?.category ?? '';
  const types = f.place_type ?? [];
  if (cat.includes('airport')) return 'AIRPORT';
  if (types.includes('poi')) return 'VENUE';
  if (types.includes('place')) return 'CITY';
  if (types.includes('address')) return 'ADDRESS';
  return 'OTHER';
}

function ctx(f: MbFeature, prefix: string): string | null {
  const hit = (f.context ?? []).find((c) => (c.id ?? '').startsWith(prefix));
  return hit?.short_code?.split('-').pop()?.toUpperCase() ?? hit?.text ?? null;
}

function toCanonical(f: MbFeature): CanonicalLocation {
  const center = f.center;
  if (!Array.isArray(center)) throw new GeocoderError('Mapbox returned no coordinates', 'UPSTREAM');
  const [lng, lat] = center;
  const address = f.place_name ?? f.text ?? '';
  return {
    lat,
    lng,
    formattedAddress: address,
    placeId: f.id ?? null,
    name: f.text ?? address.split(',')[0] ?? address,
    city: ctx(f, 'place'),
    region: ctx(f, 'region'),
    country: ctx(f, 'country'),
    geocoder: 'mapbox',
  };
}
