"use client";

/**
 * Run something once, when it is worth doing and nobody is mid-scroll.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Two features in this app learned the same lesson the same way. The map   │
 * │ built a WebGL context the instant it mounted and froze a scrolling page  │
 * │ for 1.6 seconds. The departure strip fetched a projection the instant it │
 * │ came into view and took the 95th-percentile frame to 475 ms. Both were   │
 * │ lazy already. Lazy is what put the work *after* first paint, which is    │
 * │ exactly when somebody is scrolling.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the rule, in one place: expensive optional work waits until it is near
 * the viewport *and* the page has been still for a moment. A deadline stops
 * it waiting forever on a page somebody never stops scrolling.
 *
 * `requestIdleCallback` is not enough on its own — its timeout fires whether
 * the page is busy or not, straight into the scroll it was meant to avoid.
 */

import { useEffect, type RefObject } from "react";

export interface WhenStillOptions {
  /** How long the page must be still. One frame is not enough to feel. */
  quietMs?: number;
  /**
   * Give up waiting for stillness after this and run anyway.
   *
   * `Infinity` means never force it. Right for work nobody is waiting on —
   * if the page never stops moving, the reader is not looking at this yet.
   */
  deadlineMs?: number;
  /** How far outside the viewport counts as "nearly visible". */
  rootMargin?: string;
}

export function useWhenStill(
  /**
   * The element to wait for, or null to skip the visibility gate entirely.
   *
   * Null is right for work that is cheap and whose placeholder has no height
   * — an empty div never intersects anything, so gating on it means the work
   * never runs at all.
   */
  hostRef: RefObject<Element | null> | null,
  enabled: boolean,
  run: () => void,
  options: WhenStillOptions = {},
): void {
  const { quietMs = 220, deadlineMs = 8000, rootMargin = "200px" } = options;

  useEffect(() => {
    if (!enabled) return;
    const host = hostRef?.current ?? null;

    let cancelled = false;
    let done = false;
    let timer = 0;
    let idle = 0;
    let lastScroll = 0;
    let onScreen = !host || typeof IntersectionObserver !== "function";
    let io: IntersectionObserver | null = null;

    const began = Date.now();
    const noteScroll = () => {
      lastScroll = Date.now();
    };
    window.addEventListener("scroll", noteScroll, { passive: true });

    const cleanupWatchers = () => {
      window.removeEventListener("scroll", noteScroll);
      io?.disconnect();
      io = null;
    };

    const attempt = () => {
      if (cancelled || done) return;
      const outOfTime = Number.isFinite(deadlineMs) && Date.now() - began > deadlineMs;
      // The observer will call back when it arrives.
      if (!onScreen && !outOfTime) return;
      if (Date.now() - lastScroll < quietMs && !outOfTime) {
        timer = window.setTimeout(attempt, quietMs);
        return;
      }
      done = true;
      cleanupWatchers();
      run();
    };

    if (host && typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(
        (entries) => {
          if (!entries[0]?.isIntersecting) return;
          onScreen = true;
          attempt();
        },
        { rootMargin },
      );
      io.observe(host);
    }

    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(attempt, { timeout: 1500 });
    } else {
      timer = window.setTimeout(attempt, 200);
    }

    return () => {
      cancelled = true;
      cleanupWatchers();
      if (timer) window.clearTimeout(timer);
      if (idle && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idle);
      }
    };
    /* `run` belongs in here, so callers pass a stable useCallback — an
       unstable one would restart the wait on every render and never fire. */
  }, [hostRef, enabled, run, quietMs, deadlineMs, rootMargin]);
}
