/**
 * Keyless geocoder: Photon (komoot) for autocomplete, Nominatim (OSMF) for
 * structured resolve and reverse.
 *
 * Both are public, documented, and permitted for low-volume use provided we
 * send an identifying User-Agent and stay under roughly one request per second.
 * We honour both requirements here. This is what lets RideLens ship with a
 * genuinely live location layer before any commercial key exists; it is NOT
 * adequate for consumer scale — see startupChecks KEYLESS_GEOCODER.
 */
import { httpJson } from '@/sources/http';
import {
  GeocoderError,
  type CanonicalLocation,
  type Geocoder,
  type GeocoderCapabilities,
  type PlaceSuggestion,
} from '../types';

const PHOTON_HOST = 'photon.komoot.io';
const NOMINATIM_HOST = 'nominatim.openstreetmap.org';
const TIMEOUT_MS = 6_000;

interface PhotonFeature {
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    postcode?: string;
  };
  geometry?: { coordinates?: [number, number] };
}

interface NominatimPlace {
  place_id?: number;
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
}

/** Simple in-process throttle so we never breach the ~1 req/s courtesy limit. */
class Throttle {
  private last = 0;
  constructor(private readonly minGapMs: number) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const gap = now - this.last;
    if (gap < this.minGapMs) {
      await new Promise((r) => setTimeout(r, this.minGapMs - gap));
    }
    this.last = Date.now();
  }
}

export class OsmGeocoder implements Geocoder {
  private readonly throttle = new Throttle(1100);
  private readonly contact: string | undefined;

  constructor(contactEmail?: string) {
    this.contact = contactEmail;
  }

  capabilities(): GeocoderCapabilities {
    return {
      id: 'osm',
      supportsAutocomplete: true,
      supportsReverse: true,
      requiresApiKey: false,
      rateLimitPerSecond: 1,
      attribution: '© OpenStreetMap contributors',
    };
  }

  private headers(): Record<string, string> {
    return this.contact ? { From: this.contact } : {};
  }

  async autocomplete(
    query: string,
    bias?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const url = new URL(`https://${PHOTON_HOST}/api/`);
    url.searchParams.set('q', trimmed);
    url.searchParams.set('limit', '7');
    url.searchParams.set('lang', 'en');
    if (bias) {
      url.searchParams.set('lat', bias.lat.toFixed(5));
      url.searchParams.set('lon', bias.lng.toFixed(5));
    }

    await this.throttle.wait();
    const data = await httpJson<{ features?: PhotonFeature[] }>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [PHOTON_HOST],
      headers: this.headers(),
    });

    const features = Array.isArray(data.features) ? data.features : [];
    return features.flatMap((f) => {
      const p = f.properties ?? {};
      const coords = f.geometry?.coordinates;
      const lng = Array.isArray(coords) ? coords[0] : undefined;
      const lat = Array.isArray(coords) ? coords[1] : undefined;
      if (typeof lat !== 'number' || typeof lng !== 'number') return [];

      const street = [p.housenumber, p.street].filter(Boolean).join(' ');
      const primary = p.name ?? street ?? p.city ?? 'Unknown place';
      const secondary = [
        street && street !== primary ? street : null,
        p.city ?? p.district,
        p.state,
      ]
        .filter(Boolean)
        .join(', ');

      return [
        {
          // Coordinates travel in the token so resolve() needs no second lookup.
          id: `osm:${lat.toFixed(6)},${lng.toFixed(6)}|${primary}`,
          primaryText: primary,
          secondaryText: secondary || (p.country ?? ''),
          kind: classify(p.osm_key, p.osm_value),
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
    // Fast path: the suggestion token already carries verified coordinates.
    if (suggestionOrQuery.startsWith('osm:')) {
      const body = suggestionOrQuery.slice(4);
      const [coordPart, label = ''] = body.split('|');
      const [latText, lngText] = (coordPart ?? '').split(',');
      const lat = Number(latText);
      const lng = Number(lngText);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const reversed = await this.reverse(lat, lng);
        if (reversed) return { ...reversed, name: label || reversed.name };
        return {
          lat,
          lng,
          formattedAddress: label,
          placeId: null,
          name: label,
          city: null,
          region: null,
          country: null,
          geocoder: 'osm',
        };
      }
    }

    const url = new URL(`https://${NOMINATIM_HOST}/search`);
    url.searchParams.set('q', suggestionOrQuery);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '1');
    if (hint) {
      const d = 0.5;
      url.searchParams.set(
        'viewbox',
        `${hint.lng - d},${hint.lat + d},${hint.lng + d},${hint.lat - d}`,
      );
    }

    await this.throttle.wait();
    const data = await httpJson<NominatimPlace[]>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [NOMINATIM_HOST],
      headers: this.headers(),
    });

    const first = Array.isArray(data) ? data[0] : undefined;
    if (!first) return null;
    return toCanonical(first);
  }

  async reverse(lat: number, lng: number): Promise<CanonicalLocation | null> {
    const url = new URL(`https://${NOMINATIM_HOST}/reverse`);
    url.searchParams.set('lat', lat.toFixed(6));
    url.searchParams.set('lon', lng.toFixed(6));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');

    await this.throttle.wait();
    const data = await httpJson<NominatimPlace>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [NOMINATIM_HOST],
      headers: this.headers(),
    });
    if (!data || typeof data !== 'object' || !data.display_name) return null;
    return toCanonical(data);
  }
}

function classify(key?: string, value?: string): PlaceSuggestion['kind'] {
  if (key === 'aeroway' || value === 'aerodrome' || value === 'terminal') return 'AIRPORT';
  if (key === 'amenity' || key === 'leisure' || key === 'tourism' || key === 'shop') return 'VENUE';
  if (key === 'historic' || value === 'attraction' || value === 'monument') return 'LANDMARK';
  if (key === 'place' && (value === 'city' || value === 'town' || value === 'village'))
    return 'CITY';
  if (key === 'building' || key === 'highway') return 'ADDRESS';
  return 'OTHER';
}

function toCanonical(p: NominatimPlace): CanonicalLocation {
  const lat = Number(p.lat);
  const lng = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new GeocoderError('Geocoder returned no coordinates', 'UPSTREAM');
  }
  const a = p.address ?? {};
  const display = p.display_name ?? p.name ?? '';
  return {
    lat,
    lng,
    formattedAddress: display,
    placeId: p.osm_type && p.osm_id ? `${p.osm_type}/${p.osm_id}` : null,
    name: p.name ?? display.split(',')[0] ?? display,
    city: a.city ?? a.town ?? a.village ?? a.suburb ?? null,
    region: a.state ?? a.region ?? null,
    country: a.country_code ? a.country_code.toUpperCase() : (a.country ?? null),
    geocoder: 'osm',
  };
}
