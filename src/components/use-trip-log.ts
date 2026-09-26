"use client";

/**
 * The trip log, as React reads it.
 *
 * The rules and the shape live in `lib/history/trip-log.ts`, which knows
 * nothing about browsers and is tested without one. This file is the storage
 * seam and nothing more: read the log, write the log, tell React when it
 * moved.
 *
 * ── Why a store rather than state ──────────────────────────────────────────
 *
 * Two tabs, or the recents list and the results panel in one tab, have to see
 * the same log. `useSyncExternalStore` with a `storage` subscription gives
 * that for free and keeps the read out of render, which is the same way this
 * codebase reads the theme, the network and every media query.
 *
 * ── Why every access is wrapped ────────────────────────────────────────────
 *
 * localStorage throws outright in a private window with site data blocked,
 * comes back empty after a clear, and is absent during prerender. The log is
 * a convenience; nothing on the page may depend on it existing. Every path
 * here degrades to "no history", which renders as nothing at all.
 */

import { useCallback, useSyncExternalStore } from "react";

import { addRecord, pruneRecords, toRecord, type TripRecord } from "@/lib/history/trip-log";
import type { QuoteSession } from "@/lib/domain/types";

const KEY = "ridelens.trips";

/*
 * The log, held in memory.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The first version re-read localStorage inside getSnapshot. React calls   │
 * │ that on every render to decide whether the store moved, the results      │
 * │ panel re-renders once a second off the freshness clock, and              │
 * │ localStorage.getItem is synchronous main-thread work. Scrolling fell     │
 * │ from ~120 fps to ~60, with a sixth of all frames over 33ms. The perf     │
 * │ budget caught it; nothing on screen looked wrong.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the store is read from disk exactly twice: once lazily on first use, and
 * again whenever another tab writes. Our own writes update the cache
 * directly. getSnapshot is then a field read, which is what
 * useSyncExternalStore expects it to be — and it returns a stable reference,
 * without which the hook re-renders forever.
 */

const EMPTY: TripRecord[] = [];

let cache: TripRecord[] | null = null;

function readFromStorage(): TripRecord[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    /* Private window with site data blocked. No history, not an error. */
    return EMPTY;
  }
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const pruned = pruneRecords(parsed as TripRecord[]);
    return pruned.length > 0 ? pruned : EMPTY;
  } catch {
    /* Corrupt or hand-edited. Treat it as no history rather than throwing. */
    return EMPTY;
  }
}

function getSnapshot(): TripRecord[] {
  if (cache === null) cache = readFromStorage();
  return cache;
}

/** The log does not exist on the server, and an empty one renders as nothing. */
function getServerSnapshot(): TripRecord[] {
  return EMPTY;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/* `storage` fires in *other* tabs only, so same-tab writes notify by hand. */
function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== KEY) return;
  cache = readFromStorage();
  notify();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function write(records: TripRecord[]): void {
  /* The cache moves first, so the session stays coherent even when nothing
     can be persisted — a full quota should not lose the current comparison. */
  cache = records;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* Quota, or a blocked store. */
  }
  notify();
}

export interface TripLog {
  records: TripRecord[];
  /** Records a finished comparison. Ignores one that priced nothing. */
  record: (session: QuoteSession, modelVersion: string) => void;
  /** Forgets one route entirely. */
  forgetRoute: (routeKey: string) => void;
  /** Forgets everything. */
  clear: () => void;
}

export function useTripLog(): TripLog {
  const records = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const record = useCallback((session: QuoteSession, modelVersion: string) => {
    const rec = toRecord(session, modelVersion);
    if (!rec) return;
    const current = getSnapshot();
    /* addRecord is keyed on session id, so a second event for the same
       comparison is a no-op rather than a second observation. */
    if (current.some((r) => r.id === rec.id)) return;
    write(addRecord(current, rec));
  }, []);

  const forgetRoute = useCallback((routeKey: string) => {
    write(getSnapshot().filter((r) => r.routeKey !== routeKey));
  }, []);

  const clear = useCallback(() => {
    cache = EMPTY;
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* Nothing to remove, or nothing that can be. */
    }
    notify();
  }, []);

  return { records, record, forgetRoute, clear };
}
