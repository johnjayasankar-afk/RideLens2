"use client";

/**
 * Asking about the comparison in front of you.
 *
 * The interesting part of this component is what it does with an answer it
 * cannot verify: it labels it. Every reply carries the same mark, because a
 * product that spent this much effort on not overstating a number should not
 * then present generated prose as though it came from the same place as the
 * fare.
 *
 * The assistant can also act — but it never acts itself. It returns an intent,
 * this component validates it a second time against the same schema the
 * server used, and then runs it through exactly the path the command palette
 * uses. There is no capability here that the rider does not already have.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { actionSchema, type AssistantAction } from "@/lib/assistant/actions";
import type { TripRecord } from "@/lib/history/trip-log";

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** What it did, if anything, rendered under the reply. */
  did?: string[];
  pending?: boolean;
}

interface Props {
  sessionId: string | undefined;
  trips: readonly TripRecord[];
  onAction: (action: AssistantAction) => void;
  /** Questions worth offering before anyone has typed anything. */
  suggestions: string[];
}

export function Assistant({ sessionId, trips, onAction, suggestions }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* Hidden entirely when unconfigured: a chat box that cannot answer is
     worse than no chat box. */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ask")
      .then((r) => r.json())
      .then((d: { available?: boolean }) => {
        if (!cancelled) setAvailable(Boolean(d.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /* Follow the answer as it streams, without stealing focus. */
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns]);

  const ask = useCallback(
    async (question: string) => {
      if (!sessionId || busy) return;
      const history = [...turns, { role: "user" as const, content: question }];
      setTurns([...history, { role: "assistant", content: "", pending: true }]);
      setDraft("");
      setBusy(true);

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId,
            messages: history.map((t) => ({ role: t.role, content: t.content })),
            trips,
          }),
        });

        if (!res.ok || !res.body) {
          const message =
            res.status === 429
              ? "Too many questions just now. Give it a moment."
              : res.status === 404
                ? "That comparison has expired. Run it again and I can answer about the new one."
                : "The assistant could not answer that.";
          setTurns((t) => replaceLast(t, { role: "assistant", content: message }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        const did: string[] = [];

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const event = /^event: (.+)$/m.exec(frame)?.[1];
            const raw = /^data: (.+)$/m.exec(frame)?.[1];
            if (!event || !raw) continue;
            let payload: unknown;
            try {
              payload = JSON.parse(raw);
            } catch {
              continue;
            }

            if (event === "text") {
              text += (payload as { text: string }).text;
              setTurns((t) => replaceLast(t, { role: "assistant", content: text, pending: true }));
            } else if (event === "action") {
              const { action, said } = payload as { action: unknown; said: string };
              /*
               * Validated a second time. The server checked it, but a tool
               * input is model output and model output is untrusted — and
               * this side is the one that actually runs it.
               */
              const parsed = actionSchema.safeParse(action);
              if (parsed.success) {
                did.push(said);
                onAction(parsed.data);
              }
            } else if (event === "error") {
              text = (payload as { message: string }).message;
            }
          }
        }

        setTurns((t) =>
          replaceLast(t, {
            role: "assistant",
            content: text || "I don't have an answer for that.",
            did: did.length > 0 ? did : undefined,
          }),
        );
      } catch {
        setTurns((t) =>
          replaceLast(t, { role: "assistant", content: "Could not reach the assistant." }),
        );
      } finally {
        setBusy(false);
      }
    },
    [sessionId, busy, turns, trips, onAction],
  );

  if (available !== true || !sessionId) return null;

  if (!open) {
    return (
      <button type="button" className="ask-open" onClick={() => setOpen(true)}>
        <span className="ask-open-glyph" aria-hidden>
          ✦
        </span>
        Ask about this comparison
      </button>
    );
  }

  return (
    <section className="ask" aria-label="Ask about this comparison">
      <header className="ask-head">
        <span className="ask-title">
          <span className="ask-open-glyph" aria-hidden>
            ✦
          </span>
          Ask
        </span>
        <button
          type="button"
          className="ask-close"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <span aria-hidden>×</span>
        </button>
      </header>

      <div className="ask-log" ref={logRef} role="log" aria-live="polite" aria-busy={busy}>
        {turns.length === 0 ? (
          <div className="ask-suggestions">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="chip ask-suggestion"
                onClick={() => void ask(s)}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        {turns.map((turn, i) => (
          <div key={i} className={`ask-turn is-${turn.role}`}>
            <p className="ask-text">
              {turn.content}
              {turn.pending && !turn.content ? <span className="ask-typing" aria-hidden /> : null}
            </p>
            {turn.did?.map((d) => (
              <p className="ask-did" key={d}>
                <span aria-hidden>→</span> {d}
              </p>
            ))}
          </div>
        ))}
      </div>

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          const q = draft.trim();
          if (q) void ask(q);
        }}
      >
        <input
          ref={inputRef}
          className="ask-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Why is Uber more expensive?"
          aria-label="Ask about this comparison"
          maxLength={400}
          disabled={busy}
        />
        <button type="submit" className="chip" disabled={busy || draft.trim().length === 0}>
          {busy ? "…" : "Ask"}
        </button>
      </form>

      {/*
        Said once, under the box, rather than on every reply — a mark on each
        message reads as a disclaimer nobody finishes. This says what it is
        and what it cannot do.
      */}
      <p className="ask-foot muted fine">
        Generated from the figures on this page. It cannot see live provider prices, and it will not
        invent one.
      </p>
    </section>
  );
}

function replaceLast(turns: Turn[], next: Turn): Turn[] {
  const out = turns.slice(0, -1);
  out.push(next);
  return out;
}
