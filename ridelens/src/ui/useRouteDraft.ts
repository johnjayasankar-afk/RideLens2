'use client';

/**
 * The route you were looking at, across a page refresh.
 *
 * Reloading used to empty both fields — a browser refresh, a phone waking a
 * suspended tab, an accidental pull-to-refresh, and the search was gone.
 *
 * It is deliberately NOT in the URL. Query parameters would be the obvious
 * mechanism and they are the wrong one here: a pickup and destination in the
 * address bar land in browser history, in the referrer of every outbound link,
 * and in any log that records a path. The share feature already answers
 * "give me a link" with an opaque id for exactly that reason, and reproducing
 * the location in the URL would undo it.
 *
 * `sessionStorage` fits the actual need. It is scoped to one tab, survives a
 * reload, dies when the tab closes, and never leaves the browser. A new tab
 * starts empty, which is the right answer to "am I still working on this?".
 *
 * The draft holds only what the rider typed and chose — the same labels already
 * kept in recents — and never a price: a fare from ten minutes ago restored as
 * though it were current is precisely the false confidence this product exists
 * to avoid. Restoring the form and letting them press Compare costs one tap and
 * keeps every number honest.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { PlaceValue } from './PlaceInput';

const KEY = 'ridelens.draft.v1';

export interface RouteDraft {
  pickup: PlaceValue | null;
  destination: PlaceValue | null;
}

function isPlace(v: unknown): v is PlaceValue {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<PlaceValue>;
  if (typeof p.label !== 'string' || p.label.length === 0) return false;
  if (p.suggestionId !== null && typeof p.suggestionId !== 'string') return false;
  if (p.coords === null) return true;
  return (
    typeof p.coords === 'object' &&
    typeof p.coords?.lat === 'number' &&
    typeof p.coords?.lng === 'number'
  );
}

const EMPTY: RouteDraft = Object.freeze({ pickup: null, destination: null });

/**
 * Cached so `getSnapshot` returns a stable reference between writes.
 * `useSyncExternalStore` compares by identity and will loop forever on a fresh
 * object each call.
 */
let cachedRaw: string | null = null;
let cached: RouteDraft = EMPTY;

function getSnapshot(): RouteDraft {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
  } catch {
    // Storage can be unavailable outright: private mode, blocked site data.
    return EMPTY;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  if (!raw) {
    cached = EMPTY;
    return cached;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const d = (parsed ?? {}) as Partial<RouteDraft>;
    cached = {
      pickup: isPlace(d.pickup) ? d.pickup : null,
      destination: isPlace(d.destination) ? d.destination : null,
    };
  } catch {
    // Malformed, or written by an older shape. An empty form is a fine
    // outcome, and losing the draft must never break the page.
    cached = EMPTY;
  }
  return cached;
}

/** The server has no sessionStorage, so it has no draft. */
function getServerSnapshot(): RouteDraft {
  return EMPTY;
}

const listeners = new Set<() => void>();
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
function announce() {
  cachedRaw = null;
  for (const l of listeners) l();
}

/**
 * Read as an external store rather than through an effect: a correct server
 * snapshot, no hydration mismatch, and no setState during a render pass.
 */
export function useRouteDraft() {
  const restored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const remember = useCallback((pickup: PlaceValue | null, destination: PlaceValue | null) => {
    if (typeof window === 'undefined') return;
    try {
      if (!pickup && !destination) {
        window.sessionStorage.removeItem(KEY);
      } else {
        window.sessionStorage.setItem(KEY, JSON.stringify({ pickup, destination }));
      }
      announce();
    } catch {
      // Nothing here is worth failing a render for.
    }
  }, []);

  const forget = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(KEY);
      announce();
    } catch {
      /* see above */
    }
  }, []);

  return { restored, remember, forget };
}
