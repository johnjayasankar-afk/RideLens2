"use client";

/**
 * A `localStorage`-backed store React can subscribe to.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The trip log's first version re-read localStorage inside getSnapshot.    │
 * │ React calls that on every render to decide whether the store moved, the  │
 * │ results panel re-renders once a second off the freshness clock, and      │
 * │ getItem is synchronous main-thread work. Scrolling fell from ~120 fps    │
 * │ to ~60. Nothing on screen looked wrong; the perf budget caught it.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * That lesson belongs in one place rather than in each store that learns it
 * again. Disk is read exactly twice — lazily on first use, and when another
 * tab writes — so getSnapshot is a field read returning a stable reference,
 * which is both what useSyncExternalStore requires and what keeps it off the
 * scroll path.
 *
 * ── Why every access is wrapped ────────────────────────────────────────────
 *
 * localStorage throws outright in a private window with site data blocked,
 * comes back empty after a clear, and is absent during prerender. Everything
 * built on this is a convenience; nothing on the page may depend on it
 * existing. Every path degrades to `empty`, which renders as nothing.
 */

export interface LocalStore<T> {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  /** Replaces the value and persists it. Notifies even if persisting failed. */
  set: (value: T) => void;
  /** Removes the key outright. */
  clear: () => void;
  /** The current value without subscribing — for event handlers. */
  peek: () => T;
}

export function createLocalStore<T>(
  key: string,
  options: {
    /** What "nothing stored" looks like. Must be a stable reference. */
    empty: T;
    /** Parse a stored string. Throwing, or returning null, means `empty`. */
    parse: (raw: string) => T | null;
  },
): LocalStore<T> {
  const { empty, parse } = options;
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  function readFromStorage(): T {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      /* Private window with site data blocked. Not an error. */
      return empty;
    }
    if (!raw) return empty;
    try {
      return parse(raw) ?? empty;
    } catch {
      /* Corrupt or hand-edited. Treat it as nothing stored. */
      return empty;
    }
  }

  function notify(): void {
    for (const l of listeners) l();
  }

  /* `storage` fires in *other* tabs only, so same-tab writes notify by hand. */
  function onStorage(e: StorageEvent): void {
    if (e.key !== null && e.key !== key) return;
    cache = readFromStorage();
    notify();
  }

  function peek(): T {
    if (cache === null) cache = readFromStorage();
    return cache;
  }

  return {
    peek,
    getSnapshot: peek,
    getServerSnapshot: () => empty,
    subscribe(onChange) {
      listeners.add(onChange);
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
    set(value) {
      /* The cache moves first, so the session stays coherent even when
         nothing can be persisted — a full quota should not lose the work. */
      cache = value;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* Quota, or a blocked store. */
      }
      notify();
    },
    clear() {
      cache = empty;
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* Nothing to remove, or nothing that can be. */
      }
      notify();
    },
  };
}
