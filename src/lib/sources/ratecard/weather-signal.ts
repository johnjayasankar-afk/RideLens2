/**
 * Free weather signal (Open-Meteo) — no API key.
 * Precipitation / storms are among the strongest surge predictors in NYC studies.
 */

import { cached } from "@/lib/quotes/data-cache";

export type WeatherSignal = {
  precipMm: number;
  /** 0 = dry, 1 = heavy rain/snow */
  intensity: number;
  /** Multiplicative demand lift for TNCs (1.0 = none). */
  surgeLift: number;
  label: string;
  source: "open-meteo" | "unavailable";
};

const cache = new Map<string, { at: number; value: WeatherSignal }>();
const CACHE_MS = 4 * 60_000;

function cellKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export function dryWeather(): WeatherSignal {
  return {
    precipMm: 0,
    intensity: 0,
    surgeLift: 1,
    label: "dry",
    source: "unavailable",
  };
}

/**
 * Fetch current precip near pickup. Fails soft → dryWeather.
 */
/**
 * Precipitation, cached for minutes.
 *
 * It was fetched on every comparison. Rain does not change between two taps
 * a few seconds apart, and rounding the point to ~1 km means everyone in a
 * neighbourhood shares one reading — which is also about the resolution the
 * signal actually has.
 */
export async function fetchWeatherSignal(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<WeatherSignal> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const { value } = await cached("weather", key, () =>
    fetchWeatherSignalUncached(lat, lng, signal),
  );
  return value;
}

async function fetchWeatherSignalUncached(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<WeatherSignal> {
  const key = cellKey(lat, lng);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("current", "precipitation,rain,snowfall,weather_code");
    url.searchParams.set("timezone", "auto");
    const res = await fetch(url.toString(), {
      signal: signal ?? AbortSignal.timeout(2500),
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      const miss = dryWeather();
      cache.set(key, { at: Date.now(), value: miss });
      return miss;
    }
    const data = (await res.json()) as {
      current?: {
        precipitation?: number;
        rain?: number;
        snowfall?: number;
        weather_code?: number;
      };
    };
    const precip =
      Number(data.current?.precipitation ?? 0) ||
      Number(data.current?.rain ?? 0) + Number(data.current?.snowfall ?? 0) * 0.7;
    const code = Number(data.current?.weather_code ?? 0);
    // WMO: 51–67 rain, 71–77 snow, 80–82 showers, 95–99 thunder
    const stormy = code >= 95 || (code >= 80 && code <= 82);
    const intensity = Math.min(
      1,
      precip / 4 + (stormy ? 0.35 : 0) + (code >= 61 && code < 80 ? 0.15 : 0),
    );
    // RideWise: rainy Fri evenings can roughly double Midtown demand locally.
    // We apply a bounded lift so dry days stay honest.
    const surgeLift = 1 + intensity * 0.28 + (stormy ? 0.08 : 0);
    const label =
      intensity >= 0.65
        ? "heavy_precip"
        : intensity >= 0.3
          ? "rain"
          : intensity > 0.05
            ? "drizzle"
            : "dry";
    const value: WeatherSignal = {
      precipMm: Math.round(precip * 100) / 100,
      intensity: Math.round(intensity * 1000) / 1000,
      surgeLift: Math.round(Math.min(1.45, surgeLift) * 1000) / 1000,
      label,
      source: "open-meteo",
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    const miss = dryWeather();
    cache.set(key, { at: Date.now(), value: miss });
    return miss;
  }
}
