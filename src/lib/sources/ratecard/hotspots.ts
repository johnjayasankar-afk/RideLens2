/**
 * Micro-hotspots that rideshare algorithms treat as elevated demand zones.
 * Walking 2–3 blocks off these pins often drops quotes (RideWise local insight).
 */

export type Hotspot = {
  id: string;
  lat: number;
  lng: number;
  /** km radius */
  r: number;
  /** Extra demand heat 0–0.2 */
  heat: number;
  /** Hours (local) when hotspot is especially active; empty = always */
  activeHours?: [number, number][];
};

const HOTSPOTS: Hotspot[] = [
  {
    id: "times_square",
    lat: 40.758,
    lng: -73.9855,
    r: 0.45,
    heat: 0.12,
    activeHours: [
      [10, 24],
      [0, 2],
    ],
  },
  { id: "penn_station", lat: 40.7506, lng: -73.9935, r: 0.35, heat: 0.11, activeHours: [[6, 23]] },
  { id: "port_authority", lat: 40.757, lng: -73.99, r: 0.3, heat: 0.1, activeHours: [[6, 23]] },
  { id: "grand_central", lat: 40.7527, lng: -73.9772, r: 0.3, heat: 0.09, activeHours: [[7, 22]] },
  {
    id: "msg",
    lat: 40.7505,
    lng: -73.9934,
    r: 0.4,
    heat: 0.14,
    activeHours: [
      [17, 24],
      [0, 1],
    ],
  },
  {
    id: "barclays",
    lat: 40.6826,
    lng: -73.9754,
    r: 0.4,
    heat: 0.12,
    activeHours: [
      [17, 24],
      [0, 1],
    ],
  },
  {
    id: "fidi",
    lat: 40.7074,
    lng: -74.0113,
    r: 0.5,
    heat: 0.06,
    activeHours: [
      [7, 10],
      [16, 20],
    ],
  },
  {
    id: "williamsburg_waterfront",
    lat: 40.7214,
    lng: -73.9577,
    r: 0.45,
    heat: 0.08,
    activeHours: [
      [18, 24],
      [0, 3],
    ],
  },
  { id: "ues_1st", lat: 40.7736, lng: -73.9566, r: 0.4, heat: 0.05, activeHours: [[16, 20]] },
];

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function hourActive(h: number, windows?: [number, number][]): boolean {
  if (!windows || windows.length === 0) return true;
  return windows.some(([a, b]) => {
    if (a <= b) return h >= a && h < b;
    return h >= a || h < b;
  });
}

export function hotspotHeat(
  point: { lat: number; lng: number },
  now: Date,
): { heat: number; ids: string[] } {
  const h = now.getHours() + now.getMinutes() / 60;
  let heat = 0;
  const ids: string[] = [];
  for (const spot of HOTSPOTS) {
    if (!hourActive(h, spot.activeHours)) continue;
    const d = haversineKm(point, spot);
    if (d > spot.r) continue;
    // Falloff to edge
    const w = 1 - d / spot.r;
    heat += spot.heat * w;
    ids.push(spot.id);
  }
  return { heat: Math.min(0.22, heat), ids };
}

/**
 * Directional asymmetry: outer-borough → Manhattan often cheaper than reverse
 * (RideWise: Astoria→Midtown ~18% below reverse).
 */
export function directionalAsymmetry(
  pickup: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): number {
  const pickCore =
    pickup.lat > 40.7 && pickup.lat < 40.82 && pickup.lng > -74.02 && pickup.lng < -73.93;
  const dropCore =
    destination.lat > 40.7 &&
    destination.lat < 40.82 &&
    destination.lng > -74.02 &&
    destination.lng < -73.93;
  const pickOuter =
    pickup.lat > 40.55 &&
    pickup.lat < 40.92 &&
    pickup.lng > -74.1 &&
    pickup.lng < -73.7 &&
    !pickCore;
  const dropOuter =
    destination.lat > 40.55 &&
    destination.lat < 40.92 &&
    destination.lng > -74.1 &&
    destination.lng < -73.7 &&
    !dropCore;

  if (pickOuter && dropCore) return 0.9; // cheaper into Manhattan
  if (pickCore && dropOuter) return 1.08; // pricier leaving Manhattan
  return 1;
}
