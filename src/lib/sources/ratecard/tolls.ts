/**
 * Detect likely tolled crossings from an OSRM polyline.
 * Amounts are E-ZPass-class passenger estimates used by rideshare pass-through.
 * Distinct gates are summed; mutually exclusive NJ river crossings take the max.
 */

export type LatLng = { lat: number; lng: number };

type TollGate = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** Degrees — tight to avoid false positives on nearby free roads */
  radius: number;
  amount: number;
};

const NY_TOLLS: TollGate[] = [
  {
    id: "henry_hudson",
    label: "Henry Hudson Bridge",
    lat: 40.8778,
    lng: -73.9223,
    radius: 0.0035,
    amount: 3.5,
  },
  {
    id: "rfk",
    label: "RFK / Triborough Bridge",
    lat: 40.7798,
    lng: -73.9268,
    radius: 0.005,
    amount: 10.17,
  },
  {
    id: "queensboro",
    label: "Ed Koch Queensboro Bridge",
    // Often free for cars historically; keep low / skip — actually free for cars
    lat: 40.757,
    lng: -73.9542,
    radius: 0.004,
    amount: 0,
  },
  {
    id: "lincoln",
    label: "Lincoln Tunnel",
    lat: 40.7628,
    lng: -74.0105, // deeper into tunnel approach / NJ side bias
    radius: 0.003,
    amount: 13.75,
  },
  {
    id: "holland",
    label: "Holland Tunnel",
    lat: 40.7278,
    lng: -74.031,
    radius: 0.003,
    amount: 13.75,
  },
  {
    id: "gw_bridge",
    label: "George Washington Bridge",
    lat: 40.8517,
    lng: -73.9527,
    radius: 0.0035,
    amount: 13.75,
  },
  {
    id: "verrazzano",
    label: "Verrazzano-Narrows Bridge",
    lat: 40.6066,
    lng: -74.0447,
    radius: 0.006,
    amount: 6.94, // one-way car EZPass; TLC may double some cases
  },
];

function hitsGate(
  coords: [number, number][],
  gate: TollGate,
): boolean {
  const r2 = gate.radius * gate.radius;
  for (const [lng, lat] of coords) {
    const dLat = lat - gate.lat;
    const dLng = lng - gate.lng;
    if (dLat * dLat + dLng * dLng <= r2) return true;
  }
  return false;
}

export type TollEstimate = {
  amount: number;
  gateId: string | null;
  label: string | null;
  gatesHit: string[];
  items: { id: string; label: string; amount: number }[];
};

/**
 * @param coordinates GeoJSON line [lng, lat][]
 */
export function estimateRouteTolls(
  coordinates: [number, number][] | undefined | null,
): TollEstimate {
  if (!coordinates || coordinates.length < 2) {
    return { amount: 0, gateId: null, label: null, gatesHit: [], items: [] };
  }

  // NJ river crossings only if the path actually enters New Jersey
  const entersNJ = coordinates.some(
    ([lng, lat]) => lng < -74.025 && lat > 40.68 && lat < 40.92,
  );

  const hit = NY_TOLLS.filter((g) => {
    if (g.amount <= 0) return false;
    if (
      (g.id === "lincoln" || g.id === "holland" || g.id === "gw_bridge") &&
      !entersNJ
    ) {
      return false;
    }
    return hitsGate(coordinates, g);
  });
  if (hit.length === 0) {
    return { amount: 0, gateId: null, label: null, gatesHit: [], items: [] };
  }

  // Lincoln / Holland / GWB are alternate river crossings — charge at most one
  const njExclusive = new Set(["lincoln", "holland", "gw_bridge"]);
  const njHits = hit.filter((g) => njExclusive.has(g.id));
  const otherHits = hit.filter((g) => !njExclusive.has(g.id));
  const selected: TollGate[] = [...otherHits];
  if (njHits.length > 0) {
    njHits.sort((a, b) => b.amount - a.amount);
    selected.push(njHits[0]!);
  }

  selected.sort((a, b) => b.amount - a.amount);
  const primary = selected[0]!;
  const amount = selected.reduce((sum, g) => sum + g.amount, 0);
  const items = selected.map((g) => ({
    id: g.id,
    label: g.label,
    amount: g.amount,
  }));
  return {
    amount: Math.round(amount * 100) / 100,
    gateId: primary.id,
    label:
      selected.length === 1
        ? primary.label
        : selected.map((g) => g.label).join(" + "),
    gatesHit: selected.map((g) => g.id),
    items,
  };
}

/**
 * Free-flow speed from OSRM → scale TOD traffic inflation.
 * Highway corridors inflate less; crawl corridors inflate more.
 */
export function trafficContextFactor(miles: number, osrmMinutes: number): number {
  if (osrmMinutes <= 0) return 1;
  const mph = miles / (osrmMinutes / 60);
  if (mph >= 32) return 0.82; // parkway / express
  if (mph >= 24) return 0.92; // mixed suburban
  if (mph <= 12) return 1.12; // dense crawl
  return 1;
}
