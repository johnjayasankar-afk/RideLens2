"use client";

/**
 * Price watches, as React reads them.
 *
 * The rules live in `lib/history/price-watch.ts` and the storage discipline
 * in `local-store.ts`. What is worth saying here is what this hook does
 * *not* do: it does not poll, subscribe, or arrange for anything to happen
 * while the page is closed. `evaluate` is called when a comparison arrives,
 * because that is the only moment RideLens knows a new price.
 */

import { useCallback, useSyncExternalStore } from "react";

import { createLocalStore } from "@/components/local-store";
import {
  evaluateWatch,
  pruneWatches,
  removeWatch,
  upsertWatch,
  watchForRoute,
  type PriceWatch,
  type WatchResult,
} from "@/lib/history/price-watch";

const EMPTY: PriceWatch[] = [];

const store = createLocalStore<PriceWatch[]>("ridelens.watches", {
  empty: EMPTY,
  parse: (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const pruned = pruneWatches(parsed as PriceWatch[]);
    return pruned.length > 0 ? pruned : EMPTY;
  },
});

export interface PriceWatches {
  watches: PriceWatch[];
  set: (watch: PriceWatch) => void;
  remove: (routeKey: string) => void;
  forRoute: (routeKey: string) => PriceWatch | null;
  /** Answer the standing question. Reads only. */
  evaluate: (routeKey: string, quotes: readonly { lowMinor: number }[]) => WatchResult | null;
  clear: () => void;
}

export function usePriceWatches(): PriceWatches {
  const watches = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  const set = useCallback((watch: PriceWatch) => {
    store.set(upsertWatch(store.peek(), watch));
  }, []);

  const remove = useCallback((routeKey: string) => {
    store.set(removeWatch(store.peek(), routeKey));
  }, []);

  const forRoute = useCallback((routeKey: string) => watchForRoute(store.peek(), routeKey), []);

  const evaluate = useCallback((routeKey: string, quotes: readonly { lowMinor: number }[]) => {
    const watch = watchForRoute(store.peek(), routeKey);
    if (!watch) return null;
    return evaluateWatch(watch, quotes);
  }, []);

  const clear = useCallback(() => store.clear(), []);

  return { watches, set, remove, forRoute, evaluate, clear };
}
