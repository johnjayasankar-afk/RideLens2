'use client';

/**
 * Connectivity.
 *
 * `navigator.onLine` is famously optimistic — it reports link state, not
 * reachability — so it is used only to explain a failure the rider has already
 * seen, never to pre-emptively block a search. If the browser thinks it is
 * offline and a request fails, that is worth saying; guessing beforehand is not.
 */
import { useSyncExternalStore } from 'react';

function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

const getSnapshot = () => navigator.onLine;
const getServerSnapshot = () => true;

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
