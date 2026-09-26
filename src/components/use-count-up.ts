"use client";

/**
 * A price that arrives rather than appears.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Three things make this harder than it looks in this product.             │
 * │                                                                          │
 * │ The results tree re-renders once a second — the freshness labels and the │
 * │ marketplace countdown both run off a ticking clock. A naive count-up     │
 * │ restarts on every one of those and the price never settles.              │
 * │                                                                          │
 * │ The marketplace itself moves every ~55 seconds. When a refresh lands and │
 * │ a fare genuinely changes, replaying the whole animation from zero would  │
 * │ read as a new quote rather than a small correction.                      │
 * │                                                                          │
 * │ And the numbers in between are not prices. They are never announced —    │
 * │ the accessible name carries the settled figure from the first frame —    │
 * │ and the animation is short enough that the final value is what anybody   │
 * │ actually reads.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So: counts from zero on arrival, eases from wherever it is on a later
 * change, and returns the real number untouched when motion is unwelcome.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** The house ease, near enough. cubic-bezier(0.32, 0.72, 0, 1). */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Whether to animate at all, read the way this codebase reads every other
 * browser preference — through a store rather than by calling matchMedia
 * during render.
 *
 * The server snapshot is `true`: no animation is the safe thing to render
 * before hydration, and it means a crawler and a first paint both get the
 * settled number rather than a zero.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => true,
  );
}

export interface CountUpOptions {
  durationMs?: number;
  /** False for a card that is not newly arrived. */
  enabled?: boolean;
}

export function useCountUp(target: number, options: CountUpOptions = {}): number {
  const { durationMs = 320, enabled = true } = options;
  const reduced = usePrefersReducedMotion();
  const animate = enabled && !reduced && Number.isFinite(target);

  const [display, setDisplay] = useState(target);
  const frameRef = useRef(0);
  const fromRef = useRef(target);
  const startedFor = useRef<number | null>(null);

  useEffect(() => {
    /*
     * Nothing to drive. The hook returns `target` directly below, so there
     * is no state to sync and no setState in an effect body — which the
     * React Compiler rules rightly reject.
     */
    if (!animate) return;

    /*
     * Already heading for this exact number: a re-render from the one-second
     * clock, not a new value. Leave the animation alone.
     */
    if (startedFor.current === target) return;

    const first = startedFor.current === null;
    startedFor.current = target;

    const from = first ? 0 : fromRef.current;
    const started = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      const value = t === 1 ? target : from + (target - from) * easeOut(t);
      fromRef.current = value;
      setDisplay(value);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [animate, target, durationMs]);

  return animate ? display : target;
}

/**
 * The same, for the two ends of a band.
 *
 * Two independent count-ups rather than one shared progress value, which
 * looks riskier and is not: both start in the same commit with the same
 * duration and easing, so each end is the same eased fraction of its target
 * at every instant. The low target is below the high one, so the rendered
 * low stays below the rendered high in every frame — the range cannot invert
 * mid-flight, and a frame reading "$74 to $71" would be nonsense.
 */
export function useCountUpRange(
  lowTarget: number,
  highTarget: number,
  options: CountUpOptions = {},
): { low: number; high: number } {
  const low = useCountUp(lowTarget, options);
  const high = useCountUp(highTarget, options);
  return { low, high };
}
