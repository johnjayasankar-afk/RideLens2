"use client";

/**
 * The capture that makes the model measurable.
 *
 * Shown on the handoff, after the rider has been sent to the provider — the
 * only moment they know what they were actually charged. Optional, small, and
 * silent about itself: a rider who ignores it loses nothing.
 *
 * It states what the estimate was before asking, because a question that hides
 * the prediction invites the answer it wants.
 */
import { useState } from "react";

export function ReportActual({
  sessionId,
  quoteId,
  predicted,
}: {
  sessionId: string;
  quoteId: string;
  predicted: string;
}) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (!sessionId || !quoteId) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dollars = Number(value.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setState("error");
      setMessage("Enter the amount you were charged.");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/actuals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          quoteId,
          actualMinor: Math.round(dollars * 100),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(body.error ?? "Could not save that.");
        return;
      }
      setState("done");
      setMessage(
        body.stored
          ? "Thank you — that goes straight into the calibration."
          : "Thank you. Recorded locally; this deployment has no database attached.",
      );
    } catch {
      setState("error");
      setMessage("Could not reach the server.");
    }
  };

  if (state === "done") {
    return (
      <p className="actual-done" data-testid="actual-done">
        {message}
      </p>
    );
  }

  return (
    <form className="actual-form" onSubmit={submit} data-testid="report-actual">
      <label htmlFor="actual-fare">
        <strong>What did you actually pay?</strong>
        <span className="actual-hint">
          We estimated {predicted}. Telling us the real figure is the only way this model finds out
          when it is wrong — and it is published either way, on{" "}
          <a href="/sources">the sources page</a>.
        </span>
      </label>
      <div className="actual-row">
        <input
          id="actual-fare"
          inputMode="decimal"
          autoComplete="off"
          placeholder="24.80"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (state === "error") setState("idle");
          }}
          aria-describedby={message ? "actual-msg" : undefined}
        />
        <button type="submit" className="ghost" disabled={state === "sending"}>
          {state === "sending" ? "Saving…" : "Report"}
        </button>
      </div>
      {message ? (
        <p id="actual-msg" className="actual-error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
