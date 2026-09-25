/**
 * Bike-share systems published under GBFS.
 *
 * GBFS — the General Bikeshare Feed Specification — is an open standard whose
 * entire purpose is letting trip-planning applications read a system's live
 * state. Cities routinely make publishing it a condition of an operator's
 * permit. Reading it is the intended use, not a workaround: there is no key,
 * no contract and no access control, because the data is published to be read.
 *
 * That makes it the second source RideLens can run with no credential, and the
 * only one that is genuinely real-time: station counts change minute to minute
 * and the feeds declare a 60-second TTL.
 */
import type { BBox } from '@/domain/geo';

export interface BikeSystem {
  id: string;
  /** Consumer-facing name, e.g. "Citi Bike". */
  name: string;
  operator: string;
  /** GBFS auto-discovery document. Every other feed URL is read from it. */
  discoveryUrl: string;
  /**
   * Additional hosts this system's feeds legitimately live on.
   *
   * Several operators redirect their branded discovery URL to a shared Lyft
   * host, and the HTTP client re-validates the target of every redirect against
   * an allowlist rather than following it blindly. Listing the hosts here keeps
   * that protection intact while letting the real feed through — the redirect
   * targets were checked by hand on `verifiedOn`.
   */
  extraHosts?: string[];
  /** Where the system operates; used to skip systems that cannot serve a trip. */
  bbox: BBox;
  verifiedOn: string;
}

export const BIKE_SYSTEMS: BikeSystem[] = [
  {
    id: 'citibike',
    name: 'Citi Bike',
    operator: 'Lyft',
    discoveryUrl: 'https://gbfs.citibikenyc.com/gbfs/gbfs.json',
    extraHosts: ['gbfs.lyft.com'],
    bbox: { minLat: 40.55, maxLat: 40.95, minLng: -74.15, maxLng: -73.7 },
    verifiedOn: '2026-09-04',
  },
  {
    id: 'divvy',
    name: 'Divvy',
    operator: 'Lyft',
    discoveryUrl: 'https://gbfs.divvybikes.com/gbfs/gbfs.json',
    extraHosts: ['gbfs.lyft.com'],
    bbox: { minLat: 41.6, maxLat: 42.15, minLng: -88.0, maxLng: -87.5 },
    verifiedOn: '2026-09-04',
  },
  {
    id: 'baywheels',
    name: 'Bay Wheels',
    operator: 'Lyft',
    discoveryUrl: 'https://gbfs.baywheels.com/gbfs/gbfs.json',
    // Redirects to Lyft's shared GBFS host.
    extraHosts: ['gbfs.lyftbikes.com', 'gbfs.lyft.com'],
    bbox: { minLat: 37.2, maxLat: 37.9, minLng: -122.55, maxLng: -121.8 },
    verifiedOn: '2026-09-04',
  },
  {
    id: 'capitalbikeshare',
    name: 'Capital Bikeshare',
    operator: 'Lyft',
    discoveryUrl: 'https://gbfs.capitalbikeshare.com/gbfs/gbfs.json',
    extraHosts: ['gbfs.lyft.com'],
    bbox: { minLat: 38.7, maxLat: 39.15, minLng: -77.35, maxLng: -76.85 },
    verifiedOn: '2026-09-04',
  },
  {
    id: 'bluebikes',
    name: 'Bluebikes',
    operator: 'Lyft',
    discoveryUrl: 'https://gbfs.bluebikes.com/gbfs/gbfs.json',
    extraHosts: ['gbfs.lyft.com'],
    bbox: { minLat: 42.2, maxLat: 42.45, minLng: -71.25, maxLng: -70.95 },
    verifiedOn: '2026-09-04',
  },
];

export function systemsFor(point: { lat: number; lng: number }): BikeSystem[] {
  return BIKE_SYSTEMS.filter(
    (s) =>
      point.lat >= s.bbox.minLat &&
      point.lat <= s.bbox.maxLat &&
      point.lng >= s.bbox.minLng &&
      point.lng <= s.bbox.maxLng,
  );
}

export const BIKE_MARKETS = BIKE_SYSTEMS.map((s) => s.name);

/**
 * Systems deliberately NOT shipped, so the gap is a decision on record rather
 * than an oversight:
 *
 *   Indego (Philadelphia) — the feed is live, open and readable at
 *   https://gbfs.bcycle.com/bcycle_indego/gbfs.json, and it would have paired
 *   neatly with the Philadelphia rate card. But its `system_pricing_plans`
 *   lists only passes: Indego30 at $21.60, IndegoFlex at $10.00, Access Pass
 *   at $5.40, none carrying a per-minute rate. GBFS pricing plans are whatever
 *   products an operator sells, not a fare table, and quoting the cheapest of
 *   those as a trip price would put a monthly subscription on screen labelled
 *   as a bike ride. `choosePlan` now refuses any plan that is not identifiably
 *   a single ride, so adding Indego would produce a warning rather than a
 *   wrong number — but there is no reason to add a system that can only ever
 *   decline to answer.
 */
