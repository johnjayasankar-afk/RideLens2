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
  /** Runs the intent. False when it could not be carried out. */
  onAction: (action: AssistantAction) => boolean;
  /** Questions worth offering before anyone has typed anything. */
  suggestions: string[];
}

export function Assistant({ sessionId, trips, onAction, suggestions }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);
  /*
   * Which of the two answerers is behind the box.
   *
   * `model` is Claude under the brief and its eight hard rules. `local` is a
   * matcher that recognises a question and quotes the brief, and it is not an
   * AI — calling it one in the footer would be the sort of small lie the rest
   * of this product spends its surface area refusing to tell.
   */
  const [mode, setMode] = useState<"model" | "local" | null>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /*
   * Closing the panel used to leave the request running. With a key that is
   * a model call that keeps generating and keeps billing for an answer
   * nobody will see; without one it is a stream written into a closed tab.
   */
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  /*
   * There is always an assistant now.
   *
   * This used to hide the whole feature when `ANTHROPIC_API_KEY` was unset,
   * on the reasoning that a chat box which cannot answer is worse than none.
   * That reasoning was right about the box and wrong about the premise: the
   * server answers without a key now, from the same brief, so the box is not
   * empty — it is differently sourced, and the footer says which.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ask")
      .then((r) => r.json())
      .then((d: { available?: boolean; mode?: "model" | "local" }) => {
        if (cancelled) return;
        setAvailable(Boolean(d.available));
        setMode(d.mode === "model" || d.mode === "local" ? d.mode : null);
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
    else triggerRef.current?.focus();
  }, [open]);

  /*
   * Escape closes it, from wherever focus happens to be.
   *
   * This was a React `onKeyDown` on the section, which only sees keys from
   * inside its own subtree — and the submit button disables itself the
   * instant the draft empties, so focus was on <body> by the time anyone
   * pressed Escape. Measured: the panel stayed open and `document
   * .activeElement` was BODY. A document listener has no such blind spot.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /*
   * Focus comes back to the input when the answer lands.
   *
   * Sending by Enter keeps it (the input is `readOnly`, not `disabled`), but
   * sending by pressing the button does not: the button disables itself when
   * the draft empties, and a disabled element cannot hold focus. Either way
   * the rider's next action is to type again.
   */
  useEffect(() => {
    if (open && !busy) inputRef.current?.focus();
  }, [open, busy]);

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

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            sessionId,
            /*
             * The last few exchanges, not all of them. The server caps the
             * array at twelve and rejects anything longer as malformed, so
             * the seventh question in a session — and every one after it —
             * used to come back "The assistant could not answer that." A
             * long conversation should forget its oldest turn, not die.
             */
            messages: history.slice(-10).map((t) => ({ role: t.role, content: t.content })),
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
                /*
                 * The line is written from what happened, not from what was
                 * asked. `said` is composed server-side before anything runs,
                 * so a watch that could not be set — no route in hand — still
                 * printed "Watching this trip for $40.00 or less".
                 */
                did.push(onAction(parsed.data) ? said : "That one did not go through.");
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
      } catch (err) {
        /*
         * An abort is this component tidying up after itself — the rider
         * closed the panel or left — and is not a failure worth reporting
         * into a transcript they are no longer reading.
         */
        if ((err as { name?: string } | null)?.name === "AbortError") return;
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
      <button type="button" ref={triggerRef} className="ask-open" onClick={() => setOpen(true)}>
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

      {/*
        `aria-live="off"`: with "polite" a screen reader re-announced the whole
        log on every streamed chunk, which is the answer read aloud a few
        dozen times. The finished reply is announced once, below the form.
      */}
      <div className="ask-log" ref={logRef} role="log" aria-live="off" aria-busy={busy}>
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
          /*
           * `readOnly`, not `disabled`. A disabled input is removed from the
           * tab order, so pressing Enter moved focus to <body> on every
           * single message and never gave it back — measured:
           * `document.activeElement` was BODY after each send. `ask()`
           * already refuses to re-enter while busy, so the guard was doing
           * nothing that was not already done.
           */
          readOnly={busy}
        />
        <button type="submit" className="chip" disabled={busy || draft.trim().length === 0}>
          {busy ? "…" : "Ask"}
        </button>
      </form>

      {/*
        The finished answer, announced once. The log above is `aria-live="off"`
        precisely so this can be the only thing that speaks.
      */}
      <p className="sr-only" aria-live="polite">
        {busy ? "" : (turns.at(-1)?.role === "assistant" ? turns.at(-1)?.content : "") || ""}
      </p>

      {/*
        Said once, under the box, rather than on every reply — a mark on each
        message reads as a disclaimer nobody finishes. This says what it is
        and what it cannot do.
      */}
      <p className="ask-foot muted fine">
        {mode === "local"
          ? "No language model is configured, so this reads your question and answers from the figures on this page. It recognises a question or says it does not — it cannot write prose, and it cannot invent a number."
          : "Generated from the figures on this page. It cannot see live provider prices, and it will not invent one."}
      </p>
    </section>
  );
}

function replaceLast(turns: Turn[], next: Turn): Turn[] {
  const out = turns.slice(0, -1);
  out.push(next);
  return out;
}
