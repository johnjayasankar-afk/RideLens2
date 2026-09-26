"use client";

/**
 * The trip log, as React reads it.
 *
 * The rules and the shape live in `lib/history/trip-log.ts`, which knows
 * nothing about browsers and is tested without one. The caching discipline
 * lives in `local-store.ts`, which learned it the hard way — a getSnapshot
 * that touched disk cost half the frame rate while scrolling. This file is
 * only the wiring between the two.
 */

import { useCallback, useSyncExternalStore } from "react";

import { createLocalStore } from "@/components/local-store";
import { addRecord, pruneRecords, toRecord, type TripRecord } from "@/lib/history/trip-log";
import type { QuoteSession } from "@/lib/domain/types";

/** A stable reference for "nothing", so getSnapshot never churns. */
const EMPTY: TripRecord[] = [];

const store = createLocalStore<TripRecord[]>("ridelens.trips", {
  empty: EMPTY,
  parse: (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const pruned = pruneRecords(parsed as TripRecord[]);
    return pruned.length > 0 ? pruned : EMPTY;
  },
});

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
  const records = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  const record = useCallback((session: QuoteSession, modelVersion: string) => {
    const rec = toRecord(session, modelVersion);
    if (!rec) return;
    const current = store.peek();
    /* addRecord is keyed on session id, so a second event for the same
       comparison is a no-op rather than a second observation. */
    if (current.some((r) => r.id === rec.id)) return;
    store.set(addRecord(current, rec));
  }, []);

  const forgetRoute = useCallback((routeKey: string) => {
    store.set(store.peek().filter((r) => r.routeKey !== routeKey));
  }, []);

  const clear = useCallback(() => store.clear(), []);

  return { records, record, forgetRoute, clear };
}
