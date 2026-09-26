"use client";

/**
 * "Walk two blocks."
 *
 * hotspots.ts has existed all along and never told anybody anything. It
 * makes the price higher outside Penn Station at 6pm and the rider was left
 * to wonder why — or more likely, not to wonder at all.
 *
 * Deliberately near the top of the results: it is the one thing on this page
 * a rider can act on *before* choosing a provider, and it is worthless once
 * they have already tapped through to an app.
 */

import { useCallback, useRef, useState } from "react";

import { formatMoneyMinor } from "@/lib/domain/money";
import type { WalkSuggestion } from "@/lib/domain/walk-off-hotspot";
import { useWhenStill } from "./use-when-still";

interface Payload {
  suggestion: WalkSuggestion | null;
  anchor?: { provider: string; productName: string; lowMinor: number } | null;
}

export function WalkSuggestionCard({ sessionId }: { sessionId: string | null }) {
  const [data, setData] = useState<Payload | null>(null);
  const askedFor = useRef<string | null>(null);

  const load = useCallback(() => {
    if (!sessionId || askedFor.current === sessionId) return;
    askedFor.current = sessionId;
    fetch(`/api/walk?session=${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: Payload) => setData(body))
      /* Nothing to say is the usual answer anyway. */
      .catch(() => setData({ suggestion: null }));
  }, [sessionId]);

  /*
   * No visibility gate — this renders nothing until it has an answer, and an
   * empty element never intersects. Still waits for the page to be still.
   */
  useWhenStill(null, Boolean(sessionId), load, { deadlineMs: Infinity });

  const s = data?.suggestion;
  if (!s) return null;

  const mins = Math.max(1, Math.round(s.walkSeconds / 60));

  return (
    <aside className="walk-tip" role="note">
      <span className="walk-tip-glyph" aria-hidden>
        ↗
      </span>
      <div className="walk-tip-body">
        <p className="walk-tip-lead">
          Walk {mins} min and save about {formatMoneyMinor(s.savingMinor)}
        </p>
        <p className="walk-tip-detail">{s.sentence}</p>
        {/*
          The number is modeled like every other number here, and this one
          asks somebody to physically go somewhere. It says so.
        */}
        <p className="walk-tip-note muted">
          Modeled from the same demand map that made the prices above — not a quoted fare, and the
          walk is routed on foot rather than estimated.
        </p>
      </div>
    </aside>
  );
}
