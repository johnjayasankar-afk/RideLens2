'use client';

/**
 * Live refresh.
 *
 * Auto-polling a paid quote API is a good way to spend someone else's money,
 * so this is off by default and hedged four ways:
 *
 *   1. opt-in only — the rider switches it on;
 *   2. paused whenever the tab is hidden, because a backgrounded tab has no
 *      reader and a poll it cannot show is pure cost;
 *   3. hard-stopped after MAX_CYCLES so a forgotten tab cannot poll all day;
 *   4. interval well above the cache TTL, so it never out-runs the cache.
 *
 * The countdown is shown, not hidden, so the rider always knows what is about
 * to happen on their behalf.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const REFRESH_INTERVAL_SECONDS = 45;
export const MAX_CYCLES = 12; // ~9 minutes, then it stops itself.

export interface LiveRefreshState {
  enabled: boolean;
  secondsRemaining: number;
  cyclesUsed: number;
  paused: boolean;
  exhausted: boolean;
}

export function useLiveRefresh(onTick: () => void, canRun: boolean) {
  const [requested, setRequested] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(REFRESH_INTERVAL_SECONDS);
  const [cyclesUsed, setCyclesUsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const onTickRef = useRef(onTick);

  // Keep the callback current without writing a ref during render.
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  const exhausted = cyclesUsed >= MAX_CYCLES;
  /**
   * Derived rather than stored: once the cycle budget is spent the loop is
   * off, full stop. Clearing a separate `enabled` flag from an effect would be
   * the same fact held in two places, and they would eventually disagree.
   */
  const enabled = requested && !exhausted;

  // Pause while the tab is hidden rather than firing invisible requests.
  useEffect(() => {
    if (!enabled) return;
    const sync = () => setPaused(document.visibilityState !== 'visible');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || paused || exhausted || !canRun) return;

    const timer = setInterval(() => {
      setSecondsRemaining((s) => {
        if (s > 1) return s - 1;
        // Fire outside the state updater so React never sees a side effect
        // during reconciliation.
        queueMicrotask(() => {
          onTickRef.current();
          setCyclesUsed((c) => c + 1);
        });
        return REFRESH_INTERVAL_SECONDS;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [enabled, paused, exhausted, canRun]);

  const toggle = useCallback(() => {
    setRequested((on) => {
      if (on) return false;
      setSecondsRemaining(REFRESH_INTERVAL_SECONDS);
      setCyclesUsed(0);
      return true;
    });
  }, []);

  const stop = useCallback(() => setRequested(false), []);

  const reset = useCallback(() => setSecondsRemaining(REFRESH_INTERVAL_SECONDS), []);

  return {
    state: { enabled, secondsRemaining, cyclesUsed, paused, exhausted } satisfies LiveRefreshState,
    toggle,
    stop,
    reset,
  };
}
