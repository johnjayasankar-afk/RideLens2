"use client";

/**
 * Deep-link and browser state, read during render rather than after it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS IS NOT AN EFFECT                                                │
 * │                                                                          │
 * │ CompareForm hydrated itself in a mount effect: read the query string,    │
 * │ read localStorage, read navigator.onLine, then call six setters. Every   │
 * │ one of those is a synchronous setState inside an effect, which React     │
 * │ Compiler flags because it forces a second render of a 1,024-line tree    │
 * │ before the user sees anything — and the first of those renders shows an  │
 * │ empty form to someone who arrived on a deep link.                        │
 * │                                                                          │
 * │ Each of the three reads has a correct render-time answer:                │
 * │                                                                          │
 * │   query string   useSearchParams() — available during render             │
 * │   localStorage   useSyncExternalStore with a server snapshot             │
 * │   online status  useSyncExternalStore, which is what it is for           │
 * │                                                                          │
 * │ None needs an effect, and none can produce a hydration mismatch: the     │
 * │ server snapshot is what the server actually rendered.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { useMemo, useSyncExternalStore } from "react";

import { useSearchParams } from "next/navigation";

import type { PlaceValue } from "@/components/place-field";
import type { RankingMode } from "@/lib/domain/types";

export type FilterId = "ALL" | "XL" | "PREMIUM" | "TAXI" | "standard";

export interface DeepLinkPlace {
  lat: number;
  lng: number;
  formattedAddress: string;
  label: string;
}

export function parseMode(raw: string | null): RankingMode {
  if (raw === "fastest" || raw === "best_value" || raw === "cheapest") return raw;
  return "cheapest";
}

export function parseFilter(raw: string | null): FilterId {
  if (raw === "ALL" || raw === "XL" || raw === "PREMIUM" || raw === "TAXI" || raw === "standard") {
    return raw;
  }
  return "standard";
}

/** `lat,lng,label` — the shape the existing links already use. */
export function decodePlace(raw: string | null): DeepLinkPlace | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const label = parts.slice(2).join(",").trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return { lat, lng, formattedAddress: label, label };
}

export interface DeepLinkState {
  pickup: DeepLinkPlace | null;
  destination: DeepLinkPlace | null;
  mode: RankingMode;
  filter: FilterId;
  /** True when the URL carried a complete route, so it can be compared once. */
  hasRoute: boolean;
}

/**
 * What the URL asks for, computed during render.
 *
 * Returned as *initial* values: pickup and destination become user-owned state
 * the moment anyone edits a field, so this is an initialiser rather than a
 * source of truth.
 */
export function useDeepLinkState(): DeepLinkState {
  const params = useSearchParams();
  const from = params.get("from");
  const to = params.get("to");
  const mode = params.get("mode");
  const filter = params.get("filter");

  return useMemo(() => {
    const pickup = decodePlace(from);
    const destination = decodePlace(to);
    return {
      pickup,
      destination,
      mode: parseMode(mode),
      filter: parseFilter(filter),
      hasRoute: Boolean(pickup && destination),
    };
  }, [from, to, mode, filter]);
}

/* -------------------------------------------------------------------------- */
/* Online status                                                              */
/* -------------------------------------------------------------------------- */

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether the browser thinks it has a connection.
 *
 * The server has no opinion, and assuming "online" there is right: it is what
 * the markup was rendered for, so the first client render agrees with it and
 * nothing flashes.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/* -------------------------------------------------------------------------- */
/* Recent routes                                                              */
/* -------------------------------------------------------------------------- */

/*
 * The existing key and record shape, unchanged.
 *
 * These moved here from compare-form.tsx rather than being rewritten: the key
 * and the fields are a storage contract with every browser that has already
 * used RideLens, and a tidier shape would have quietly orphaned their saved
 * routes.
 */
const RECENT_KEY = "ridelens.recentRoutes";
/** `storage` only fires in *other* tabs, so this one needs telling. */
const RECENT_EVENT = "ridelens:recent-routes-changed";

export type RecentRoute = {
  id: string;
  pickup: PlaceValue;
  destination: PlaceValue;
  savedAt: number;
};

/** Stable empty array: a fresh one each call would spin useSyncExternalStore. */
const NO_ROUTES: RecentRoute[] = [];

let recentCache: { raw: string | null; parsed: RecentRoute[] } = {
  raw: null,
  parsed: NO_ROUTES,
};

export function loadRecent(): RecentRoute[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RECENT_KEY);
  } catch {
    return NO_ROUTES;
  }
  /*
   * getSnapshot has to return the same reference while nothing has changed, or
   * React re-renders forever. Parsing on every call would return a new array
   * each time and do exactly that, so the last parse is cached against the raw
   * string it came from.
   */
  if (raw === recentCache.raw) return recentCache.parsed;
  let parsed: RecentRoute[] = NO_ROUTES;
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (Array.isArray(value)) parsed = value as RecentRoute[];
  } catch {
    parsed = NO_ROUTES;
  }
  recentCache = { raw, parsed };
  return parsed;
}

export function saveRecent(pickup: PlaceValue, destination: PlaceValue): void {
  try {
    const next: RecentRoute = {
      id: `${pickup.lat},${pickup.lng}->${destination.lat},${destination.lng}`,
      pickup,
      destination,
      savedAt: Date.now(),
    };
    const prev = loadRecent().filter((r) => r.id !== next.id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([next, ...prev].slice(0, 6)));
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    /* private mode / quota — not a reason to fail a comparison */
  }
}

export function clearRecentRoutes(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    /* ignored */
  }
}

function subscribeRecent(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(RECENT_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RECENT_EVENT, onChange);
  };
}

export function useRecentRoutes(): RecentRoute[] {
  return useSyncExternalStore(subscribeRecent, loadRecent, () => NO_ROUTES);
}

/* -------------------------------------------------------------------------- */
/* Pointer / viewport                                                         */
/* -------------------------------------------------------------------------- */

const COARSE_QUERIES = ["(pointer: coarse)", "(max-width: 720px)"] as const;

function subscribeCoarse(onChange: () => void): () => void {
  const lists = COARSE_QUERIES.map((q) => window.matchMedia(q));
  for (const l of lists) l.addEventListener("change", onChange);
  return () => {
    for (const l of lists) l.removeEventListener("change", onChange);
  };
}

/**
 * Whether to steal focus into the destination field on arrival.
 *
 * Only on a desktop: autofocusing on a phone throws the keyboard up over the
 * page before the reader has seen it. The server snapshot is `false`, so the
 * markup never carries an autofocus the client would have to take back.
 */
export function useDesktopAutofocus(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => !COARSE_QUERIES.some((q) => window.matchMedia(q).matches),
    () => false,
  );
}
