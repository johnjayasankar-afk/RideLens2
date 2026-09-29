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

export function AlternativesRow({
  sessionId,
  embedded,
}: {
  sessionId: string | null;
  /**
   * Rendered inside the insights deck, behind a tab.
   *
   * Which changes what "no alternative" has to look like. Stacked on the
   * page, rendering nothing was right — an absent section is quieter than an
   * empty one. Behind a tab somebody just chose, nothing is a broken panel,
   * so the states become visible and the heading goes to the deck.
   */
  embedded?: boolean;
}) {
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
   * No visibility gate: until this has data it renders nothing taller than a
   * line, and an empty element never intersects, so waiting to be seen would
   * mean never running. Still waits for the page to be still — nobody is
   * blocked on it, and inside the deck it does not mount until a reader has
   * asked for it, which is a better gate than either.
   */
  useWhenStill(null, Boolean(sessionId), load, { deadlineMs: Infinity });

  if (!sessionId) return null;

  if (data.state !== "ready") {
    if (!embedded) return null;
    return data.state === "none" ? (
      /*
       * A claim about this app's coverage, not a claim about the world.
       *
       * ┌──────────────────────────────────────────────────────────────────┐
       * │ This said "Nothing here gets you there without a car", which is  │
       * │ a statement that no transit exists on the route — and the module │
       * │ that produced the empty array says the opposite in its own       │
       * │ header: "the absence of a row on a cross-town trip is not a      │
       * │ claim that transit is unavailable". The panel was making exactly │
       * │ the claim the library refused to make, on a route where the      │
       * │ subway plainly runs.                                             │
       * └──────────────────────────────────────────────────────────────────┘
       */
      <p className="deck-empty muted">
        RideLens only shows a way without a car where a published fare covers the whole journey —
        today that is the three New York airport runs. It has nothing for this route, which is not
        the same as there being nothing.
      </p>
    ) : (
      <p className="deck-empty muted" aria-live="polite">
        Checking what runs on this route…
      </p>
    );
  }

  return (
    <>
      {data.state === "ready" ? (
        <section className="alternatives" aria-labelledby="alternatives-heading">
          <h2 id="alternatives-heading" className={embedded ? "sr-only" : "section-label"}>
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
                      /*
                       * Rendered as absent, not filled in — and now with the
                       * reason the library already wrote. `durationNote` was
                       * built at alternatives.ts, typed at types.ts under the
                       * comment "Why the duration is missing, when it is",
                       * shipped in every API response, and read by nothing.
                       * A stated absence is worth more with its reason.
                       */
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
                  {/*
                    Why the journey time is missing, in the library's own
                    words. It was constructed in alternatives.ts, declared in
                    types.ts under the comment "Why the duration is missing,
                    when it is", shipped in every API response — and read by
                    nothing, so the panel said "not modeled" and never said
                    why. It goes in the visible note rather than a `title`,
                    which no keyboard and no touch screen can reach.
                  */}
                  {alt.durationSeconds == null && alt.durationNote ? (
                    <p className="alternative-note muted">{alt.durationNote}</p>
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
