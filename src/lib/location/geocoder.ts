import type { CanonicalLocation } from "@/lib/domain/types";
import { getEnv } from "@/lib/config";

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  /** Short, human-readable address for the input field */
  formattedAddress: string;
  lat?: number;
  lng?: number;
}

export interface Geocoder {
  autocomplete(
    query: string,
    proximity?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]>;
  resolve(placeIdOrQuery: string): Promise<CanonicalLocation | null>;
  reverse(lat: number, lng: number): Promise<CanonicalLocation | null>;
}

function nominatimHeaders(): HeadersInit {
  const env = getEnv();
  return {
    Accept: "application/json",
    "User-Agent": `RideLens/1.0 (${env.NEXT_PUBLIC_APP_URL})`,
  };
}

type AddressParts = {
  name?: string | null;
  housenumber?: string | null;
  street?: string | null;
  city?: string | null;
  locality?: string | null;
  district?: string | null;
  suburb?: string | null;
  county?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
  countrycode?: string | null;
};

const US_STATE_ABBR: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

function abbreviateRegion(region?: string | null): string | undefined {
  if (!region) return undefined;
  const t = region.trim();
  if (t.length <= 3) return t.toUpperCase();
  return US_STATE_ABBR[t.toLowerCase()] || t;
}

/** Clean two-line place label — never dump full OSM/Nominatim soup. */
export function formatPlaceLabel(parts: AddressParts): {
  primaryText: string;
  secondaryText: string;
  formattedAddress: string;
} {
  const line =
    [parts.housenumber, parts.street].filter(Boolean).join(" ").trim() ||
    parts.name?.trim() ||
    "";

  const city = parts.city || parts.locality || parts.district || parts.suburb;
  const region = abbreviateRegion(parts.state);
  const secondaryBits = [city, region].filter(Boolean) as string[];
  const secondaryText = secondaryBits
    .filter((b) => b && !line.toLowerCase().includes(String(b).toLowerCase()))
    .join(", ");

  const primaryText = line || secondaryText || "Selected place";
  const formattedAddress = [primaryText, secondaryText]
    .filter(Boolean)
    .join(", ");

  return { primaryText, secondaryText, formattedAddress };
}

function photonOsmId(props: {
  osm_type?: string;
  osm_id?: number | string;
}): string {
  const t = (props.osm_type || "N").charAt(0).toUpperCase();
  return `photon:${t}${props.osm_id ?? "0"}`;
}

const AIRPORT_ALIASES: Record<string, string> = {
  jfk: "John F. Kennedy International Airport",
  "jfk airport": "John F. Kennedy International Airport",
  "kennedy airport": "John F. Kennedy International Airport",
  "kennedy international": "John F. Kennedy International Airport",
  lga: "LaGuardia Airport",
  laguardia: "LaGuardia Airport",
  "laguardia airport": "LaGuardia Airport",
  ewr: "Newark Liberty International Airport",
  newark: "Newark Liberty International Airport",
  "newark airport": "Newark Liberty International Airport",
  sfo: "San Francisco International Airport",
  lax: "Los Angeles International Airport",
  ord: "O'Hare International Airport",
  bos: "Boston Logan International Airport",
};

function expandAirportQuery(q: string): string {
  const key = q.trim().toLowerCase().replace(/\./g, "");
  return AIRPORT_ALIASES[key] || q;
}

function placeRank(props: {
  osm_key?: string;
  osm_value?: string;
  type?: string;
  name?: string | null;
  housenumber?: string | null;
}): number {
  if (props.osm_key === "aeroway" || props.osm_value === "aerodrome") return 100;
  if (props.osm_key === "shop" || props.osm_value === "mall") return 85;
  if (props.osm_key === "amenity" || props.osm_key === "tourism" || props.osm_key === "leisure")
    return 80;
  if (props.name && !props.housenumber) return 55;
  if (props.type === "house" && props.housenumber && !props.name) return 45;
  if (props.osm_key === "highway" || props.type === "street") return 10;
  return 40;
}

function queryMatchBoost(query: string, name?: string | null): number {
  if (!name) return 0;
  const q = query.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  if (!q || !n) return 0;
  if (n === q) return 50;
  if (n.startsWith(q)) return 35;
  if (n.includes(q)) return 25;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => n.includes(t))) return 20;
  return 0;
}

/**
 * Photon (Komoot) — free OSM geocoder with clean structured address fields.
 * Default when no Mapbox/Google key is configured.
 */
export class PhotonGeocoder implements Geocoder {
  private base = "https://photon.komoot.io";

  private featureToSuggestion(f: {
    geometry?: { coordinates?: [number, number] };
    properties?: AddressParts & {
      osm_type?: string;
      osm_id?: number;
      osm_key?: string;
      osm_value?: string;
      type?: string;
    };
  }): PlaceSuggestion | null {
    const coords = f.geometry?.coordinates;
    const p = f.properties;
    if (!coords || !p) return null;
    const [lng, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // Prefer POI/landmark names (even when Photon attaches a housenumber)
    const preferName =
      Boolean(p.name) &&
      p.osm_key !== "highway" &&
      p.type !== "street" &&
      (p.osm_key === "aeroway" ||
        p.osm_value === "aerodrome" ||
        p.osm_key === "shop" ||
        p.osm_key === "amenity" ||
        p.osm_key === "tourism" ||
        p.osm_key === "leisure" ||
        p.osm_key === "building" ||
        !p.housenumber);
    const label = preferName
      ? formatPlaceLabel({
          name: p.name,
          city: p.city || p.locality,
          state: p.state,
        })
      : formatPlaceLabel(p);
    return {
      placeId: photonOsmId(p),
      ...label,
      lat,
      lng,
    };
  }

  async autocomplete(
    query: string,
    proximity?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]> {
    if (!query.trim()) return [];
    const raw = query.trim();
    const expanded = expandAirportQuery(raw);
    const batches = expanded === raw ? [raw] : [expanded, raw];
    const out: PlaceSuggestion[] = [];
    const seen = new Set<string>();

    for (const q of batches) {
      const url = new URL(`${this.base}/api/`);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", "12");
      url.searchParams.set("lang", "en");
      if (proximity) {
        url.searchParams.set("lat", String(proximity.lat));
        url.searchParams.set("lon", String(proximity.lng));
      } else {
        // NYC default bias so national/global Photon hits don't drown local POIs
        url.searchParams.set("lat", "40.758");
        url.searchParams.set("lon", "-73.9855");
      }
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        next: { revalidate: 0 },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: AddressParts & {
            osm_type?: string;
            osm_id?: number;
            osm_key?: string;
            osm_value?: string;
            type?: string;
          };
        }>;
      };
      for (const f of data.features || []) {
        const s = this.featureToSuggestion(f);
        if (!s) continue;
        const key = `${s.formattedAddress}|${s.lat?.toFixed(4)}|${s.lng?.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const props = f.properties || {};
        const rank =
          placeRank(props) + queryMatchBoost(raw, props.name || s.primaryText);
        out.push(Object.assign(s, { _rank: rank }));
      }
      if (out.some((s) => (s as PlaceSuggestion & { _rank?: number })._rank! >= 100)) {
        break;
      }
    }

    out.sort((a, b) => {
      const ra = (a as PlaceSuggestion & { _rank?: number })._rank ?? 0;
      const rb = (b as PlaceSuggestion & { _rank?: number })._rank ?? 0;
      if (rb !== ra) return rb - ra;
      if (!proximity) return 0;
      const da =
        a.lat == null || a.lng == null
          ? Number.POSITIVE_INFINITY
          : (a.lat - proximity.lat) ** 2 + (a.lng - proximity.lng) ** 2;
      const db =
        b.lat == null || b.lng == null
          ? Number.POSITIVE_INFINITY
          : (b.lat - proximity.lat) ** 2 + (b.lng - proximity.lng) ** 2;
      return da - db;
    });

    return out.slice(0, 6).map((s) => {
      const { _rank, ...rest } = s as PlaceSuggestion & { _rank?: number };
      void _rank;
      return rest;
    });
  }

  async resolve(placeIdOrQuery: string): Promise<CanonicalLocation | null> {
    if (placeIdOrQuery.startsWith("photon:")) {
      // Coordinates should already be on the client; fall back to search string after colon
      return null;
    }
    const suggestions = await this.autocomplete(placeIdOrQuery);
    const s = suggestions[0];
    if (!s || s.lat == null || s.lng == null) return null;
    return {
      lat: s.lat,
      lng: s.lng,
      formattedAddress: s.formattedAddress,
      placeId: s.placeId,
      name: s.primaryText,
      city: s.secondaryText.split(",")[0]?.trim(),
      region: s.secondaryText.split(",")[1]?.trim(),
      country: "US",
    };
  }

  async reverse(lat: number, lng: number): Promise<CanonicalLocation | null> {
    const url = new URL(`${this.base}/reverse`);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("lang", "en");
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: AddressParts & { osm_type?: string; osm_id?: number };
      }>;
    };
    const s = data.features?.[0]
      ? this.featureToSuggestion(data.features[0])
      : null;
    if (!s || s.lat == null || s.lng == null) return null;
    return {
      lat: s.lat,
      lng: s.lng,
      formattedAddress: s.formattedAddress,
      placeId: s.placeId,
      name: s.primaryText,
      city: s.secondaryText.split(",")[0]?.trim(),
      region: s.secondaryText.split(",")[1]?.trim(),
    };
  }
}

export class NominatimGeocoder implements Geocoder {
  async autocomplete(
    query: string,
    proximity?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]> {
    if (!query.trim()) return [];
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "6");
    if (proximity) {
      url.searchParams.set(
        "viewbox",
        `${proximity.lng - 0.35},${proximity.lat + 0.35},${proximity.lng + 0.35},${proximity.lat - 0.35}`,
      );
      url.searchParams.set("bounded", "0");
    }
    const res = await fetch(url, { headers: nominatimHeaders() });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      name?: string;
      address?: {
        house_number?: string;
        road?: string;
        city?: string;
        town?: string;
        village?: string;
        suburb?: string;
        state?: string;
        postcode?: string;
        country?: string;
        country_code?: string;
      };
    }>;
    return data.map((d) => {
      const a = d.address || {};
      const label = formatPlaceLabel({
        name: d.name,
        housenumber: a.house_number,
        street: a.road,
        city: a.city || a.town || a.village,
        suburb: a.suburb,
        state: a.state,
        postcode: a.postcode,
        country: a.country,
        countrycode: a.country_code,
      });
      // If structured parse failed, take first two comma segments only
      if (!label.primaryText || label.formattedAddress.length > 80) {
        const parts = d.display_name.split(",").map((p) => p.trim());
        label.primaryText = parts[0] || d.display_name;
        label.secondaryText = parts.slice(1, 3).join(", ");
        label.formattedAddress = [label.primaryText, label.secondaryText]
          .filter(Boolean)
          .join(", ");
      }
      return {
        placeId: `nominatim:${d.place_id}`,
        ...label,
        lat: Number(d.lat),
        lng: Number(d.lon),
      };
    });
  }

  async resolve(placeIdOrQuery: string): Promise<CanonicalLocation | null> {
    if (placeIdOrQuery.startsWith("nominatim:")) {
      return null;
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", placeIdOrQuery);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");

    const res = await fetch(url, { headers: nominatimHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      name?: string;
      address?: {
        house_number?: string;
        road?: string;
        city?: string;
        town?: string;
        state?: string;
        country?: string;
        country_code?: string;
      };
    }>;
    const d = data[0];
    if (!d) return null;
    const a = d.address || {};
    const label = formatPlaceLabel({
      name: d.name,
      housenumber: a.house_number,
      street: a.road,
      city: a.city || a.town,
      state: a.state,
      country: a.country,
      countrycode: a.country_code,
    });
    return {
      lat: Number(d.lat),
      lng: Number(d.lon),
      formattedAddress: label.formattedAddress || d.display_name.split(",").slice(0, 3).join(", "),
      placeId: `nominatim:${d.place_id}`,
      name: label.primaryText,
      city: a.city || a.town,
      region: a.state,
      country: a.country_code?.toUpperCase() || a.country,
    };
  }

  async reverse(lat: number, lng: number): Promise<CanonicalLocation | null> {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    const res = await fetch(url, { headers: nominatimHeaders() });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      name?: string;
      address?: {
        house_number?: string;
        road?: string;
        city?: string;
        town?: string;
        state?: string;
        country?: string;
        country_code?: string;
      };
    };
    if (!d?.lat) return null;
    const a = d.address || {};
    const label = formatPlaceLabel({
      name: d.name,
      housenumber: a.house_number,
      street: a.road,
      city: a.city || a.town,
      state: a.state,
      country: a.country,
      countrycode: a.country_code,
    });
    return {
      lat: Number(d.lat),
      lng: Number(d.lon),
      formattedAddress: label.formattedAddress,
      placeId: `nominatim:${d.place_id}`,
      name: label.primaryText,
      city: a.city || a.town,
      region: a.state,
      country: a.country_code?.toUpperCase() || a.country,
    };
  }
}

export class MapboxGeocoder implements Geocoder {
  constructor(private token: string) {}

  async autocomplete(
    query: string,
    proximity?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]> {
    if (!query.trim()) return [];
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
    );
    url.searchParams.set("access_token", this.token);
    url.searchParams.set("autocomplete", "true");
    url.searchParams.set("limit", "6");
    if (proximity) {
      url.searchParams.set("proximity", `${proximity.lng},${proximity.lat}`);
    }
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      features: Array<{
        id: string;
        text: string;
        place_name: string;
        center: [number, number];
      }>;
    };
    return (data.features || []).map((f) => {
      const secondary = f.place_name.replace(f.text, "").replace(/^,\s*/, "");
      return {
        placeId: f.id,
        primaryText: f.text,
        secondaryText: secondary,
        formattedAddress: [f.text, secondary].filter(Boolean).join(", "),
        lat: f.center[1],
        lng: f.center[0],
      };
    });
  }

  async resolve(placeIdOrQuery: string): Promise<CanonicalLocation | null> {
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(placeIdOrQuery)}.json`,
    );
    url.searchParams.set("access_token", this.token);
    url.searchParams.set("limit", "1");
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features: Array<{
        id: string;
        text: string;
        place_name: string;
        center: [number, number];
        context?: Array<{ id: string; text: string }>;
      }>;
    };
    const f = data.features?.[0];
    if (!f) return null;
    const ctx = f.context || [];
    const secondary = f.place_name.replace(f.text, "").replace(/^,\s*/, "");
    return {
      lat: f.center[1],
      lng: f.center[0],
      formattedAddress: [f.text, secondary].filter(Boolean).join(", "),
      placeId: f.id,
      name: f.text,
      city: ctx.find((c) => c.id.startsWith("place"))?.text,
      region: ctx.find((c) => c.id.startsWith("region"))?.text,
      country: ctx.find((c) => c.id.startsWith("country"))?.text,
    };
  }

  async reverse(lat: number, lng: number): Promise<CanonicalLocation | null> {
    return this.resolve(`${lng},${lat}`);
  }
}

export class GoogleGeocoder implements Geocoder {
  constructor(private key: string) {}

  async autocomplete(
    query: string,
    proximity?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]> {
    if (!query.trim()) return [];
    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json",
    );
    url.searchParams.set("input", query);
    url.searchParams.set("key", this.key);
    if (proximity) {
      url.searchParams.set("location", `${proximity.lat},${proximity.lng}`);
      url.searchParams.set("radius", "50000");
    }
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      predictions: Array<{
        place_id: string;
        structured_formatting: {
          main_text: string;
          secondary_text: string;
        };
        description: string;
      }>;
    };
    return (data.predictions || []).map((p) => ({
      placeId: p.place_id,
      primaryText: p.structured_formatting.main_text,
      secondaryText: p.structured_formatting.secondary_text,
      formattedAddress: [
        p.structured_formatting.main_text,
        p.structured_formatting.secondary_text,
      ]
        .filter(Boolean)
        .join(", "),
      // coords filled via resolve on select
    }));
  }

  async resolve(placeIdOrQuery: string): Promise<CanonicalLocation | null> {
    if (!placeIdOrQuery.includes(" ") && placeIdOrQuery.length > 8) {
      const url = new URL(
        "https://maps.googleapis.com/maps/api/place/details/json",
      );
      url.searchParams.set("place_id", placeIdOrQuery);
      url.searchParams.set(
        "fields",
        "geometry,formatted_address,name,address_component",
      );
      url.searchParams.set("key", this.key);
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          result?: {
            geometry: { location: { lat: number; lng: number } };
            formatted_address: string;
            name?: string;
            address_components?: Array<{
              long_name: string;
              short_name: string;
              types: string[];
            }>;
          };
        };
        const r = data.result;
        if (r) {
          const comps = r.address_components || [];
          const streetNum = comps.find((c) =>
            c.types.includes("street_number"),
          )?.long_name;
          const route = comps.find((c) => c.types.includes("route"))?.long_name;
          const city = comps.find((c) => c.types.includes("locality"))?.long_name;
          const region = comps.find((c) =>
            c.types.includes("administrative_area_level_1"),
          )?.short_name;
          const label = formatPlaceLabel({
            name: r.name,
            housenumber: streetNum,
            street: route,
            city,
            state: region,
          });
          return {
            lat: r.geometry.location.lat,
            lng: r.geometry.location.lng,
            formattedAddress: label.formattedAddress || r.formatted_address,
            placeId: placeIdOrQuery,
            name: label.primaryText,
            city,
            region,
            country: comps.find((c) => c.types.includes("country"))?.short_name,
          };
        }
      }
    }

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", placeIdOrQuery);
    url.searchParams.set("key", this.key);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results: Array<{
        place_id: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
      }>;
    };
    const r = data.results?.[0];
    if (!r) return null;
    const short = r.formatted_address.split(",").slice(0, 3).join(",").trim();
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: short,
      placeId: r.place_id,
    };
  }

  async reverse(lat: number, lng: number): Promise<CanonicalLocation | null> {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", this.key);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results: Array<{
        place_id: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
      }>;
    };
    const r = data.results?.[0];
    if (!r) return null;
    const short = r.formatted_address.split(",").slice(0, 3).join(",").trim();
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: short,
      placeId: r.place_id,
    };
  }
}

export function getGeocoder(): Geocoder {
  const env = getEnv();
  const key = env.LOCATION_PROVIDER_API_KEY || env.NEXT_PUBLIC_MAP_KEY;
  if (env.LOCATION_PROVIDER === "mapbox" && key) {
    return new MapboxGeocoder(key);
  }
  if (env.LOCATION_PROVIDER === "google" && key) {
    return new GoogleGeocoder(key);
  }
  if (env.LOCATION_PROVIDER === "nominatim") {
    return new NominatimGeocoder();
  }
  if (env.LOCATION_PROVIDER === "photon") {
    return new PhotonGeocoder();
  }
  if (key) {
    if (key.startsWith("pk.")) return new MapboxGeocoder(key);
    return new GoogleGeocoder(key);
  }
  // Default: Photon — clean OSM addresses, no API key
  return new PhotonGeocoder();
}

/** Canonicalize both ends of a route with a single geocoder instance. */
export async function canonicalizeRoute(input: {
  pickup: {
    lat?: number;
    lng?: number;
    query?: string;
    placeId?: string;
    formattedAddress?: string;
  };
  destination: {
    lat?: number;
    lng?: number;
    query?: string;
    placeId?: string;
    formattedAddress?: string;
  };
}): Promise<{ pickup: CanonicalLocation; destination: CanonicalLocation }> {
  const geo = getGeocoder();

  async function one(
    side: typeof input.pickup,
  ): Promise<CanonicalLocation> {
    if (side.lat != null && side.lng != null) {
      const addr =
        side.formattedAddress ||
        (await geo.reverse(side.lat, side.lng))?.formattedAddress ||
        `${side.lat.toFixed(5)}, ${side.lng.toFixed(5)}`;
      return {
        lat: side.lat,
        lng: side.lng,
        formattedAddress: addr,
        placeId: side.placeId,
        name: addr.split(",")[0]?.trim(),
      };
    }
    const q = side.formattedAddress || side.query || side.placeId;
    if (!q) throw new Error("Location requires coordinates or an address");
    const resolved = await geo.resolve(q);
    if (!resolved) throw new Error(`Could not find: ${q}`);
    return resolved;
  }

  const [pickup, destination] = await Promise.all([
    one(input.pickup),
    one(input.destination),
  ]);
  return { pickup, destination };
}
