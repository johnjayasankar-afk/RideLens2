/**
 * Road route geometry for the map.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS NOT PROVIDER TRIP DATA.                                          │
 * │ Requirement: never manufacture a trip duration from a map service and    │
 * │ present it as the provider's. Everything this module returns is tagged   │
 * │ MAP_ESTIMATE, is stored on the session rather than on any quote, and is  │
 * │ rendered with an explicit "map estimate" label. A quote's                │
 * │ tripDurationSeconds is only ever the provider's own number.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Uses the public OSRM demo server, which is keyless and permitted for light
 * use. Failure is non-fatal: the map falls back to a straight line between the
 * two points, which is honest about being a schematic.
 */
import { httpJson } from '@/sources/http';
import { getConfig } from '@/config/env';
import { logger } from '@/observability/logger';
import type { Point } from '@/domain/geo';
import type { CanonicalLocation } from './types';

const DEFAULT_ROUTING_HOST = 'router.project-osrm.org';
const TIMEOUT_MS = 4_000;

/**
 * The public OSRM instance is intended for development and light use. An
 * operator running real traffic should self-host or buy a routing service and
 * point ROUTING_BASE_URL at it; the interface is unchanged.
 */
function routingHost(): string {
  const configured = getConfig().ROUTING_BASE_URL;
  if (!configured) return DEFAULT_ROUTING_HOST;
  try {
    return new URL(configured).hostname;
  } catch {
    return DEFAULT_ROUTING_HOST;
  }
}

export interface RouteGeometry {
  /** [lng, lat] pairs, ready for a GeoJSON LineString. */
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
  /** Always MAP_ESTIMATE. Kept explicit so no caller can forget. */
  provenance: 'MAP_ESTIMATE';
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: Array<[number, number]>; type?: string };
  }>;
}

export interface RouteMeasurement {
  distanceMeters: number;
  durationSeconds: number;
  provenance: 'MAP_ESTIMATE';
  /**
   * The routed polyline, present when `withGeometry` was asked for. The fare
   * engine uses it to see whether the route goes through a tolled crossing.
   */
  coordinates?: Array<[number, number]>;
}

/**
 * Distance and duration only, without geometry.
 *
 * The regulated-fare engine needs a measured route the way a taxi meter needs
 * an odometer. This is the same upstream call as the map's, minus the polyline,
 * so it is cheap and can be requested on the quote path.
 */
export async function fetchRouteMeasurement(
  pickup: Point,
  destination: Point,
  signal?: AbortSignal,
  withGeometry = false,
): Promise<RouteMeasurement | null> {
  const host = routingHost();
  const coords = `${pickup.lng.toFixed(6)},${pickup.lat.toFixed(6)};${destination.lng.toFixed(6)},${destination.lat.toFixed(6)}`;
  const url = new URL(`https://${host}/route/v1/driving/${coords}`);
  // Full geometry, not simplified: toll detection asks whether the route passes
  // a specific structure, and a simplified line can step clean over a tunnel
  // mouth. Same request either way, so the cost is bytes, not a round trip.
  url.searchParams.set('overview', withGeometry ? 'full' : 'false');
  if (withGeometry) url.searchParams.set('geometries', 'geojson');

  try {
    const data = await httpJson<OsrmResponse>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [host],
      signal,
    });
    const route = data.routes?.[0];
    if (
      data.code !== 'Ok' ||
      !route ||
      typeof route.distance !== 'number' ||
      typeof route.duration !== 'number' ||
      route.distance <= 0
    ) {
      return null;
    }
    const coordinates = route.geometry?.coordinates;
    return {
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      provenance: 'MAP_ESTIMATE',
      ...(withGeometry && Array.isArray(coordinates) && coordinates.length >= 2
        ? { coordinates }
        : {}),
    };
  } catch (err) {
    logger.debug('route_measurement.failed', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

export async function fetchRouteGeometry(
  pickup: CanonicalLocation,
  destination: CanonicalLocation,
  signal?: AbortSignal,
): Promise<RouteGeometry | null> {
  if (getConfig().ENABLE_ROUTE_GEOMETRY !== 'true') return null;

  const coords = `${pickup.lng.toFixed(6)},${pickup.lat.toFixed(6)};${destination.lng.toFixed(6)},${destination.lat.toFixed(6)}`;
  const host = routingHost();
  const url = new URL(`https://${host}/route/v1/driving/${coords}`);
  url.searchParams.set('overview', 'simplified');
  url.searchParams.set('geometries', 'geojson');

  try {
    const data = await httpJson<OsrmResponse>(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      allowedHosts: [host],
      signal,
    });

    const route = data.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (
      data.code !== 'Ok' ||
      !route ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      typeof route.distance !== 'number' ||
      typeof route.duration !== 'number'
    ) {
      return null;
    }

    return {
      coordinates,
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      provenance: 'MAP_ESTIMATE',
    };
  } catch (err) {
    // A missing route line is cosmetic. Never fail a comparison over it.
    logger.debug('route_geometry.failed', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}
