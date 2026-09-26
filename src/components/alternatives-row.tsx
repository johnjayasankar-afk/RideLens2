"use client";

/**
 * The row that tells you not to take a car.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Midtown to JFK is about $73 in a car and $11.75 on the AirTrain. A       │
 * │ comparison product that knows that and does not say it is a shopping     │
 * │ funnel wearing a comparison's clothes.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Two rules it has to hold:
 *
 *   • The saving is quoted against the *cheapest* car on the board, using
 *     that car's low end — the most favourable number the car has. If
 *     transit still wins against that, it wins honestly.
 *
 *   • A missing journey time is rendered as missing. The fares here are
 *     published and sourced; the times are not, and "about 55 minutes" would
 *     be exactly the sort of unsourced figure this codebase has already had
 *     to go back and strip out once.
 */

import { useCallback, useRef, useState } from "react";

import { formatMoneyMinor } from "@/lib/domain/money";
import type { TransitAlternative } from "@/lib/transit/types";
import { useWhenStill } from "./use-when-still";

type State =
  | { state: "idle" }
  | { state: "ready"; alternatives: TransitAlternative[]; carLowMinor: number | null }
  | { state: "none" };

function minutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} min`;
}

export function AlternativesRow({ sessionId }: { sessionId: string | null }) {
  const [data, setData] = useState<State>({ state: "idle" });
  const askedFor = useRef<string | null>(null);

  const load = useCallback(() => {
    if (!sessionId || askedFor.current === sessionId) return;
    askedFor.current = sessionId;
    fetch(`/api/alternatives?session=${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { alternatives: TransitAlternative[]; carLowMinor: number | null }) => {
        setData(
          body.alternatives.length > 0
            ? {
                state: "ready",
                alternatives: body.alternatives,
                carLowMinor: body.carLowMinor,
              }
            : { state: "none" },
        );
      })
      .catch(() => setData({ state: "none" }));
  }, [sessionId]);

  /*
   * No visibility gate: until this has data it renders nothing, and an empty
   * element never intersects, so waiting to be seen would mean never running.
   * Still waits for the page to be still — nobody is blocked on it.
   */
  useWhenStill(null, Boolean(sessionId), load, { deadlineMs: Infinity });

  if (!sessionId) return null;

  return (
    <>
      {data.state === "ready" ? (
        <section className="alternatives" aria-labelledby="alternatives-heading">
          <h2 id="alternatives-heading" className="section-label">
            Without a car
          </h2>
          <ul className="alternatives-list">
            {data.alternatives.map((alt) => {
              const saving =
                data.carLowMinor != null && data.carLowMinor > alt.fareMinor
                  ? data.carLowMinor - alt.fareMinor
                  : null;
              return (
                <li key={alt.id} className="alternative">
                  <div className="alternative-head">
                    <strong>{alt.label}</strong>
                    <span className="alternative-fare">
                      {alt.fareMinor === 0 ? "Free" : formatMoneyMinor(alt.fareMinor)}
                    </span>
                  </div>
                  <p className="alternative-meta muted">
                    {alt.durationSeconds != null ? (
                      <span>{minutes(alt.durationSeconds)}</span>
                    ) : (
                      /* Rendered as absent, not filled in. */
                      <span>Journey time not modeled</span>
                    )}
                    {saving != null ? (
                      <>
                        {" · "}
                        <span className="alternative-saving">
                          {formatMoneyMinor(saving)} less than the cheapest car
                        </span>
                      </>
                    ) : null}
                  </p>
                  {alt.unmodeled ? (
                    <p className="alternative-note">
                      Does not include {alt.unmodeled} — the real total is higher.
                    </p>
                  ) : null}
                  {alt.sources.length > 0 ? (
                    <p className="alternative-sources muted">
                      {alt.sources.map((s, i) => (
                        <span key={s.url}>
                          {i > 0 ? " · " : ""}
                          <a href={s.url} target="_blank" rel="noopener noreferrer">
                            {s.label}
                          </a>{" "}
                          (checked {s.verifiedOn})
                        </span>
                      ))}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
