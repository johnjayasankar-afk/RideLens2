/**
 * Tolled crossings, detected from the route the trip actually takes.
 *
 * Every rate card in this product says some version of the same sentence: the
 * meter is the meter, and tolls are added on top. New York's is explicit —
 * "discounted E-ZPass tolls will be added to the passenger fare at the end of
 * the trip". Leaving them out is not neutral: the single most-quoted route in
 * the app, JFK to Manhattan, is $74.75 on the meter and around seven dollars
 * more if the driver takes the Queens-Midtown Tunnel. That is a tenth of the
 * fare, missing.
 *
 * So tolls are modelled, with two deliberate limits:
 *
 *  1. A toll is only claimed when the **routed polyline actually passes
 *     through** the crossing. No guessing from origin and destination.
 *  2. A toll goes to the **top of the band, never the bottom**, and is marked
 *     uncertain. The driver picks the route, and most tolled crossings here
 *     have a free alternative — the Queensboro Bridge is free, the tunnel is
 *     not. "Between X and Y, depending on the way they go" is the true answer.
 *
 * Amounts are the E-ZPass passenger-car rate, because that is what a metered
 * taxi is charged and passes on.
 */

import { distanceMeters, type Point } from '@/domain/geo';

export interface TollFacility {
  id: string;
  label: string;
  /** E-ZPass passenger-car rate in minor units. */
  amountMinor: number;
  /** Toll gantry or barrier position. */
  at: Point;
  /**
   * How close the route must come to count as having used it. Tight enough not
   * to fire on a parallel road, loose enough to survive a simplified polyline.
   */
  radiusMeters: number;
  /** Which market's cards may charge it. */
  marketId: string;
  authority: string;
}

/**
 * Only crossings where a toll is unavoidable once you are on them, and whose
 * position is unambiguous. A gantry in the middle of a long tolled highway is
 * deliberately left out: catching it depends on polyline density rather than on
 * the route, and a toll that appears and disappears with the sampling is worse
 * than one that is honestly absent.
 */
export const TOLL_FACILITIES: TollFacility[] = [
  // ── New York ───────────────────────────────────────────────────────────
  {
    id: 'queens_midtown',
    label: 'Queens-Midtown Tunnel toll',
    amountMinor: 694,
    at: { lat: 40.7434, lng: -73.9601 },
    radiusMeters: 420,
    marketId: 'nyc',
    authority: 'MTA Bridges and Tunnels',
  },
  {
    id: 'hugh_carey',
    label: 'Hugh L. Carey Tunnel toll',
    amountMinor: 694,
    at: { lat: 40.6923, lng: -74.0136 },
    radiusMeters: 420,
    marketId: 'nyc',
    authority: 'MTA Bridges and Tunnels',
  },
  {
    id: 'rfk',
    label: 'RFK (Triborough) Bridge toll',
    amountMinor: 694,
    at: { lat: 40.7877, lng: -73.9273 },
    radiusMeters: 600,
    marketId: 'nyc',
    authority: 'MTA Bridges and Tunnels',
  },
  {
    id: 'whitestone',
    label: 'Bronx-Whitestone Bridge toll',
    amountMinor: 694,
    at: { lat: 40.8036, lng: -73.8309 },
    radiusMeters: 600,
    marketId: 'nyc',
    authority: 'MTA Bridges and Tunnels',
  },
  {
    id: 'throgs_neck',
    label: 'Throgs Neck Bridge toll',
    amountMinor: 694,
    at: { lat: 40.8016, lng: -73.7936 },
    radiusMeters: 600,
    marketId: 'nyc',
    authority: 'MTA Bridges and Tunnels',
  },
  {
    id: 'verrazzano',
    label: 'Verrazzano-Narrows Bridge toll',
    amountMinor: 703,
    at: { lat: 40.6066, lng: -74.0447 },
    radiusMeters: 900,
    marketId: 'nyc',
    authority: 'MTA Bridges and Tunnels',
  },
  {
    id: 'lincoln_tunnel',
    label: 'Lincoln Tunnel toll',
    amountMinor: 1506,
    at: { lat: 40.7625, lng: -74.0186 },
    radiusMeters: 500,
    marketId: 'nyc',
    authority: 'the Port Authority of NY & NJ',
  },
  {
    id: 'holland_tunnel',
    label: 'Holland Tunnel toll',
    amountMinor: 1506,
    at: { lat: 40.7267, lng: -74.0211 },
    radiusMeters: 500,
    marketId: 'nyc',
    authority: 'the Port Authority of NY & NJ',
  },
  {
    id: 'gwb',
    label: 'George Washington Bridge toll',
    amountMinor: 1506,
    at: { lat: 40.8517, lng: -73.9527 },
    radiusMeters: 800,
    marketId: 'nyc',
    authority: 'the Port Authority of NY & NJ',
  },

  // ── Boston ─────────────────────────────────────────────────────────────
  {
    id: 'sumner',
    label: 'Sumner Tunnel toll',
    amountMinor: 200,
    at: { lat: 42.3672, lng: -71.0448 },
    radiusMeters: 450,
    marketId: 'boston',
    authority: 'MassDOT',
  },
  {
    id: 'ted_williams',
    label: 'Ted Williams Tunnel toll',
    amountMinor: 200,
    at: { lat: 42.3487, lng: -71.0227 },
    radiusMeters: 600,
    marketId: 'boston',
    authority: 'MassDOT',
  },

  // ── San Francisco ──────────────────────────────────────────────────────
  {
    id: 'bay_bridge',
    label: 'Bay Bridge toll',
    amountMinor: 800,
    at: { lat: 37.8181, lng: -122.3477 },
    radiusMeters: 900,
    marketId: 'sf',
    authority: 'the Bay Area Toll Authority',
  },
  {
    id: 'golden_gate',
    label: 'Golden Gate Bridge toll',
    amountMinor: 1050,
    at: { lat: 37.8065, lng: -122.4753 },
    radiusMeters: 800,
    marketId: 'sf',
    authority: 'the Golden Gate Bridge District',
  },
];

export interface DetectedToll {
  id: string;
  label: string;
  amountMinor: number;
  authority: string;
}

/**
 * Which tolled crossings this route passes through.
 *
 * The test is per-vertex against the gantry position. A simplified polyline can
 * step over a small radius, which is why every radius here is set to the scale
 * of the structure rather than of a point — and why a missed toll is the
 * failure mode we accept, since it only ever leaves the quote where it already
 * was.
 */
export function tollsOnRoute(
  marketId: string,
  coordinates: ReadonlyArray<readonly [number, number]>,
): DetectedToll[] {
  if (coordinates.length < 2) return [];
  const candidates = TOLL_FACILITIES.filter((f) => f.marketId === marketId);
  if (candidates.length === 0) return [];

  const found: DetectedToll[] = [];
  for (const f of candidates) {
    const hit = coordinates.some((c) => {
      const lng = c[0];
      const lat = c[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      return distanceMeters({ lat, lng }, f.at) <= f.radiusMeters;
    });
    if (hit) {
      found.push({ id: f.id, label: f.label, amountMinor: f.amountMinor, authority: f.authority });
    }
  }
  return found;
}
