'use client';

/**
 * Saved places and recent routes, local to the browser.
 *
 * Where a rider lives and works is the most sensitive thing this product could
 * hold, so it is held in localStorage and never sent to RideLens. Signed-in
 * sync would live in `profiles` / `recent_searches`, both owner-only and
 * owner-deletable.
 *
 * Retention rules from docs/SECURITY.md apply:
 *   - small caps, no timestamps beyond ordering;
 *   - NO fare is ever stored with a route — a price from an hour ago is a
 *     memory, and showing it as current is the one thing RideLens must not do;
 *   - deleting is a visible, one-click action.
 *
 * localStorage is an external store, so it is read with useSyncExternalStore
 * rather than an effect: correct server snapshot, no hydration mismatch, and
 * changes in another tab propagate.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { PlaceValue } from './PlaceInput';

const KEY = 'ridelens.places.v2';
const MAX_RECENTS = 6;

export type SavedSlot = 'home' | 'work';

export interface RecentRoute {
  pickup: PlaceValue;
  destination: PlaceValue;
}

export interface PlacesState {
  saved: Partial<Record<SavedSlot, PlaceValue>>;
  recents: RecentRoute[];
}

const EMPTY: PlacesState = Object.freeze({ saved: {}, recents: [] });

let cache: PlacesState = EMPTY;
let cachedRaw: string | null = null;
const listeners = new Set<() => void>();

function isPlaceValue(v: unknown): v is PlaceValue {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.label === 'string' && 'suggestionId' in o && 'coords' in o;
}

function parse(raw: string | null): PlacesState {
  if (!raw) return EMPTY;
  try {
    const j: unknown = JSON.parse(raw);
    if (typeof j !== 'object' || j === null) return EMPTY;
    const obj = j as { saved?: unknown; recents?: unknown };

    const saved: Partial<Record<SavedSlot, PlaceValue>> = {};
    if (typeof obj.saved === 'object' && obj.saved !== null) {
      for (const slot of ['home', 'work'] as const) {
        const v = (obj.saved as Record<string, unknown>)[slot];
        if (isPlaceValue(v)) saved[slot] = v;
      }
    }

    const recents = Array.isArray(obj.recents)
      ? obj.recents
          .filter(
            (r): r is RecentRoute =>
              typeof r === 'object' &&
              r !== null &&
              isPlaceValue((r as RecentRoute).pickup) &&
              isPlaceValue((r as RecentRoute).destination),
          )
          .slice(0, MAX_RECENTS)
      : [];

    if (Object.keys(saved).length === 0 && recents.length === 0) return EMPTY;
    return { saved, recents };
  } catch {
    return EMPTY;
  }
}

function getSnapshot(): PlacesState {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Private mode or storage disabled — places are a convenience, never fatal.
    return EMPTY;
  }
  // Re-parse only when the underlying string changed, so the snapshot stays
  // referentially stable and React does not loop.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cache = parse(raw);
  }
  return cache;
}

function getServerSnapshot(): PlacesState {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function write(next: PlacesState): void {
  try {
    if (Object.keys(next.saved).length === 0 && next.recents.length === 0) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    }
  } catch {
    // Quota or disabled storage: nothing persists, the UI still behaves.
  }
  for (const l of listeners) l();
}

function routeKey(r: RecentRoute): string {
  return `${r.pickup.label}→${r.destination.label}`;
}

/** "Current location" is a moving target, not a place worth remembering. */
function isEphemeral(p: PlaceValue): boolean {
  return p.suggestionId === null && p.coords !== null;
}

export function usePlaces() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const rememberRoute = useCallback((pickup: PlaceValue, destination: PlaceValue) => {
    if (isEphemeral(pickup)) return;
    const current = getSnapshot();
    const entry: RecentRoute = { pickup, destination };
    write({
      saved: current.saved,
      recents: [entry, ...current.recents.filter((r) => routeKey(r) !== routeKey(entry))].slice(
        0,
        MAX_RECENTS,
      ),
    });
  }, []);

  const savePlace = useCallback((slot: SavedSlot, place: PlaceValue | null) => {
    const current = getSnapshot();
    const saved = { ...current.saved };
    if (place === null || isEphemeral(place)) delete saved[slot];
    else saved[slot] = place;
    write({ saved, recents: current.recents });
  }, []);

  const clearRecents = useCallback(() => {
    const current = getSnapshot();
    write({ saved: current.saved, recents: [] });
  }, []);

  const clearAll = useCallback(() => write(EMPTY), []);

  return {
    saved: state.saved,
    recents: state.recents,
    rememberRoute,
    savePlace,
    clearRecents,
    clearAll,
    hasAny: state.recents.length > 0 || Object.keys(state.saved).length > 0,
  };
}
