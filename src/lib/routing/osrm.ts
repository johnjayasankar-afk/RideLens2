import { getEnv } from "@/lib/config";

export type RouteGeometry = {
  type: "LineString";
  coordinates: [number, number][]; // [lng, lat]
};

export type DrivingRoute = {
  meters: number;
  seconds: number;
  miles: number;
  minutes: number;
  via: string;
  geometry: RouteGeometry;
  bbox: [number, number, number, number]; // west,south,east,north
};

function osrmBase(): string {
  return getEnv().OSRM_BASE_URL.replace(/\/$/, "");
}

function bboxOf(coords: [number, number][]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lng, lat] of coords) {
    w = Math.min(w, lng);
    s = Math.min(s, lat);
    e = Math.max(e, lng);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

function decodePolyline(
  str: string,
  precision = 5,
): [number, number][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: [number, number][] = [];
  const factor = 10 ** precision;

  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push([lng / factor, lat / factor]);
  }
  return coordinates;
}

export async function fetchDrivingRoute(
  pickup: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<DrivingRoute> {
  const endpoints = [
    osrmBase(),
    "https://routing.openstreetmap.de/routed-car",
  ];

  let lastError: unknown;
  for (const base of endpoints) {
    try {
      const url = `${base}/route/v1/driving/${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}?overview=full&geometries=polyline&steps=false`;
      const res = await fetch(url, {
        signal: signal ?? AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        lastError = new Error(`OSRM ${res.status}`);
        continue;
      }
      const data = (await res.json()) as {
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: string;
        }>;
      };
      const route = data.routes?.[0];
      if (!route?.geometry) {
        lastError = new Error("OSRM empty route");
        continue;
      }
      const coordinates = decodePolyline(route.geometry);
      if (coordinates.length < 2) {
        lastError = new Error("OSRM geometry too short");
        continue;
      }
      return {
        meters: route.distance,
        seconds: route.duration,
        miles: route.distance / 1609.344,
        minutes: route.duration / 60,
        via: base.includes("openstreetmap.de") ? "osrm_de" : "osrm",
        geometry: { type: "LineString", coordinates },
        bbox: bboxOf(coordinates),
      };
    } catch (e) {
      lastError = e;
    }
  }

  // Fallback straight-ish line
  const coordinates: [number, number][] = [
    [pickup.lng, pickup.lat],
    [destination.lng, destination.lat],
  ];
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(destination.lat - pickup.lat);
  const dLng = toRad(destination.lng - pickup.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(pickup.lat)) *
      Math.cos(toRad(destination.lat)) *
      Math.sin(dLng / 2) ** 2;
  const straight = 2 * R * Math.asin(Math.sqrt(a));
  const meters = straight * 1.35;
  const seconds = (meters / 1000 / 28) * 3600;
  void lastError;
  return {
    meters,
    seconds,
    miles: meters / 1609.344,
    minutes: seconds / 60,
    via: "haversine_fallback",
    geometry: { type: "LineString", coordinates },
    bbox: bboxOf(coordinates),
  };
}
