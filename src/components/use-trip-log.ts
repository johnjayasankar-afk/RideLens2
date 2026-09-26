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
 * A serialised snapshot, kept so getSnapshot can return a stable reference.
 * Returning a fresh array each call makes useSyncExternalStore re-render
 * forever, which is the classic way to hang a page with this hook.
 */
let cachedRaw: string | null = null;
let cachedValue: TripRecord[] = [];

const EMPTY: TripRecord[] = [];

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): TripRecord[] {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  if (!raw) {
    cachedValue = EMPTY;
    return cachedValue;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    cachedValue = Array.isArray(parsed) ? pruneRecords(parsed as TripRecord[]) : EMPTY;
  } catch {
    /* Corrupt or hand-edited. Treat it as no history rather than throwing. */
    cachedValue = EMPTY;
  }
  return cachedValue;
}

/** The log does not exist on the server, and an empty one renders as nothing. */
function getServerSnapshot(): TripRecord[] {
  return EMPTY;
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  /* `storage` fires in *other* tabs, so same-tab writes notify by hand. */
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(records: TripRecord[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* Quota, or a blocked store. The in-memory snapshot below still updates,
       so the session stays coherent even when nothing can be persisted. */
  }
  cachedRaw = readRaw();
  cachedValue = records;
  for (const l of listeners) l();
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
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* Nothing to remove, or nothing that can be. */
    }
    cachedRaw = null;
    cachedValue = EMPTY;
    for (const l of listeners) l();
  }, []);

  return { records, record, forgetRoute, clear };
}
