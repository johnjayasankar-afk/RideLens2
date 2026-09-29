"use client";

/**
 * One sensitivity report, read in two places.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The panel draws the whole thing behind a tab. The console shows the one  │
 * │ line of it that belongs above the fold: whether the ordering this page   │
 * │ is recommending survives its own assumptions. Two components, one        │
 * │ answer, and it must not be fetched twice — the endpoint re-runs the fare │
 * │ engine a few dozen times, and running it twice for the same comparison   │
 * │ would be paying for it twice to print it once.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A module-level cache keyed by the comparison and the options on screen, with
 * the in-flight promise kept so a second caller joins the first rather than
 * starting another. `useSyncExternalStore` reads it; the stored state objects
 * are referentially stable, which is what keeps the snapshot from looking new
 * on every render.
 */

import { useSyncExternalStore } from "react";

import type { SensitivityReport } from "@/lib/domain/sensitivity";

export type SensitivityState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; report: SensitivityReport }
  | { state: "none"; reason: string }
  | { state: "failed" };

const IDLE: SensitivityState = { state: "idle" };
const LOADING: SensitivityState = { state: "loading" };
const FAILED: SensitivityState = { state: "failed" };

const cache = new Map<string, SensitivityState>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function publish(key: string, next: SensitivityState): void {
  cache.set(key, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The comparison plus the options on screen: a filter changes the answer. */
export function sensitivityKey(sessionId: string, quoteIds: readonly string[]): string {
  return `${sessionId}|${[...quoteIds].sort().join(",")}`;
}

/**
 * Start the fetch if nobody has.
 *
 * Safe to call from anywhere and as often as you like; the second caller for a
 * key joins the first. Deliberately not a hook, so the console's chip and the
 * panel can both ask without coordinating.
 */
export function loadSensitivity(sessionId: string, quoteIds: readonly string[]): void {
  const key = sensitivityKey(sessionId, quoteIds);
  if (inflight.has(key) || cache.has(key)) return;
  inflight.add(key);
  publish(key, LOADING);

  const only = quoteIds.length > 0 ? `&only=${encodeURIComponent(quoteIds.join(","))}` : "";
  fetch(`/api/sensitivity?session=${encodeURIComponent(sessionId)}${only}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((body: { report: SensitivityReport | null; reason?: string }) => {
      publish(
        key,
        body.report
          ? { state: "ready", report: body.report }
          : { state: "none", reason: body.reason ?? "There is nothing here to re-run." },
      );
    })
    .catch(() => publish(key, FAILED))
    .finally(() => inflight.delete(key));
}

export function useSensitivity(sessionId: string | null, quoteIds: readonly string[]) {
  const key = sessionId ? sensitivityKey(sessionId, quoteIds) : "";
  return useSyncExternalStore(
    subscribe,
    () => (key ? (cache.get(key) ?? IDLE) : IDLE),
    () => IDLE,
  );
}
