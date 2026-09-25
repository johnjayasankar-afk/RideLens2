/**
 * Geocoder selection. Exactly one geocoder is active per deployment so a route
 * is never resolved by two different providers with two different coordinates.
 */
import { getConfig, type AppConfig } from '@/config/env';
import { FixtureGeocoder } from './providers/fixture';
import { GoogleGeocoder } from './providers/google';
import { MapboxGeocoder } from './providers/mapbox';
import { OsmGeocoder } from './providers/osm';
import type { Geocoder } from './types';

let instance: Geocoder | null = null;

export function createGeocoder(cfg: AppConfig): Geocoder {
  switch (cfg.geocoderProvider) {
    case 'google':
      return new GoogleGeocoder(cfg.LOCATION_PROVIDER_API_KEY ?? '');
    case 'mapbox':
      return new MapboxGeocoder(cfg.LOCATION_PROVIDER_API_KEY ?? cfg.NEXT_PUBLIC_MAP_KEY ?? '');
    case 'fixture':
      return new FixtureGeocoder();
    case 'osm':
    default:
      return new OsmGeocoder(cfg.OSM_CONTACT_EMAIL);
  }
}

export function getGeocoder(): Geocoder {
  if (!instance) instance = createGeocoder(getConfig());
  return instance;
}

export function resetGeocoder(): void {
  instance = null;
}
