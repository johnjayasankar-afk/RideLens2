"use client";

/**
 * How much this number depends on the model being right.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A tornado, because the shape is the argument. Each bar is one input      │
 * │ moved either way and the engine re-run; the shaded strip down the middle │
 * │ is the band actually printed on the card. When the bars reach past the   │
 * │ strip — and they usually do — the picture says in one look what a        │
 * │ paragraph could not: the precision on the card is precision *given the   │
 * │ inputs*, and the inputs are estimates too.                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The bars are decoration. Every figure they draw is printed beside them as
 * text, so nothing here is available only to somebody who can see a chart.
 *
 * A lever that moves nothing is drawn as nothing and labelled as nothing —
 * see the note under the taxi's traffic row in sensitivity.test.ts. A flat
 * response is a real finding about a tariff and gets to stay visible.
 */

import { useCallback, useRef, useState } from "react";

import { useWhenStill } from "./use-when-still";

import { formatMoneyMinor } from "@/lib/domain/money";
import type { SensitivityReport } from "@/lib/domain/sensitivity";

type Loaded =
  | { state: "loading" }
  | { state: "ready"; report: SensitivityReport }
  | { state: "none"; reason: string }
  | { state: "failed" };

/**
 * Fetched once per comparison, when the tab is opened.
 *
 * Eight scenarios across every priced product is a few dozen runs of the fare
 * engine — cheap, and still not work to do on the way to a price nobody has
 * asked to interrogate yet. The deck only mounts this when it is chosen, and
 * the shared stillness gate keeps the response's render off a scrolling frame.
 */
export function SensitivityStrip({
  sessionId,
  quoteIds,
}: {
  sessionId: string | null;
  /**
   * The ids of the options currently on screen.
   *
   * Sent so the ranking verdict is about the board the rider has, not the one
   * the session was priced with — a comparison filtered to Standard shows
   * three of six, and "the cheapest stays cheapest" is a different claim about
   * each set.
   */
  quoteIds: readonly string[];
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const askedFor = useRef<string | null>(null);
  const key = `${sessionId}|${quoteIds.join(",")}`;

  const load = useCallback(() => {
    if (!sessionId || askedFor.current === key) return;
    askedFor.current = key;
    const only = quoteIds.length > 0 ? `&only=${encodeURIComponent(quoteIds.join(","))}` : "";
    fetch(`/api/sensitivity?session=${encodeURIComponent(sessionId)}${only}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { report: SensitivityReport | null; reason?: string }) => {
        setLoaded(
          body.report
            ? { state: "ready", report: body.report }
            : { state: "none", reason: body.reason ?? "There is nothing here to re-run." },
        );
      })
      .catch(() => setLoaded({ state: "failed" }));
  }, [sessionId, key, quoteIds]);

  useWhenStill(null, Boolean(sessionId), load, { deadlineMs: Infinity });

  if (!sessionId) return null;
  if (loaded.state === "loading") {
    return (
      <p className="deck-empty muted" aria-live="polite">
        Re-running the model under eight scenarios…
      </p>
    );
  }
  if (loaded.state === "failed") {
    return (
      <p className="deck-empty muted">
        The scenarios could not be run. The comparison above is unaffected.
      </p>
    );
  }
  if (loaded.state === "none") return <p className="deck-empty muted">{loaded.reason}</p>;
  return <SensitivityChart report={loaded.report} />;
}

function money(dollars: number): string {
  return formatMoneyMinor(Math.round(dollars * 100));
}

function signed(dollars: number): string {
  if (Math.abs(dollars) < 0.005) return "no change";
  return `${dollars > 0 ? "+" : "−"}${money(Math.abs(dollars))}`;
}

function SensitivityChart({ report }: { report: SensitivityReport }) {
  const [openId, setOpenId] = useState<string | null>(null);

  /*
   * One symmetric scale for every row, and the card's band measured on the
   * same one. Per-row scaling would draw the flat lever as wide as the worst
   * one, which is the opposite of what this panel is for.
   */
  const reach = Math.max(
    0.5,
    ...report.levers.flatMap((l) => [Math.abs(l.down.deltaDollars), Math.abs(l.up.deltaDollars)]),
    Math.abs(report.bandHighDollars - report.baselineDollars),
    Math.abs(report.bandLowDollars - report.baselineDollars),
  );
  const scale = reach * 1.1;
  const pos = (delta: number) => 50 + (delta / scale) * 50;

  return (
    <div className="tor">
      <p className="tor-headline">{report.headline}</p>

      <p className="tor-legend muted">
        Bars are {report.subject} re-priced with one input changed. The strip down the middle is the
        band on its card — {money(report.bandLowDollars)}–{money(report.bandHighDollars)} — drawn on
        the same scale.
      </p>

      <ul className="tor-rows">
        {report.levers.map((lever) => (
          <li
            className="tor-row"
            key={lever.id}
            data-flat={lever.swingDollars < 0.005 || undefined}
          >
            <button
              type="button"
              className="tor-name"
              aria-expanded={openId === lever.id}
              onClick={() => setOpenId(openId === lever.id ? null : lever.id)}
            >
              {lever.label}
            </button>

            <span className="tor-track" aria-hidden>
              <span
                className="tor-band"
                style={{
                  left: `${pos(report.bandLowDollars - report.baselineDollars)}%`,
                  width: `${pos(report.bandHighDollars - report.baselineDollars) - pos(report.bandLowDollars - report.baselineDollars)}%`,
                }}
              />
              <span className="tor-zero" />
              <Arm delta={lever.down.deltaDollars} pos={pos} />
              <Arm delta={lever.up.deltaDollars} pos={pos} />
            </span>

            <span className="tor-arms">
              {lever.swingDollars < 0.005 ? (
                <span className="muted">unmoved either way</span>
              ) : (
                <>
                  <span>
                    {lever.down.label} <strong>{signed(lever.down.deltaDollars)}</strong>
                  </span>
                  <span>
                    {lever.up.label} <strong>{signed(lever.up.deltaDollars)}</strong>
                  </span>
                </>
              )}
            </span>

            {openId === lever.id ? <p className="tor-explain">{lever.explain}</p> : null}
          </li>
        ))}
      </ul>

      <dl className="tor-verdicts">
        <div>
          <dt>Where it can land</dt>
          <dd>
            {money(report.envelopeLowDollars)} to {money(report.envelopeHighDollars)}, across every
            scenario above and the card&rsquo;s own band.{" "}
            {report.insideBand
              ? "Every scenario landed inside the band already printed — on this trip the band is doing its job."
              : "That is wider than the band, which is the point: the band assumes the inputs, and these are the inputs being wrong."}{" "}
            Not a range anyone is quoting.
          </dd>
        </div>
        <div>
          <dt>Does the order hold?</dt>
          <dd>
            {report.ranking.stable ? (
              <>
                {report.subject} is the cheapest under all {report.ranking.tested} scenarios. The
                choice is not resting on an assumption.
              </>
            ) : (
              <>
                {report.ranking.upsets.length} of {report.ranking.tested} scenarios change who wins:
                <span className="tor-upsets">
                  {report.ranking.upsets.map((u) => (
                    <span key={u}>{u}</span>
                  ))}
                </span>
              </>
            )}
          </dd>
        </div>
      </dl>

      <p className="deck-foot muted">
        Every figure here is the same fare engine that priced the card, called once more with one
        input moved. It is what the model is sensitive to, not what is going to happen — and the
        sizes of the moves are not error bars. Nothing has measured how wrong these inputs usually
        are; see docs/CALIBRATION.md.
      </p>
    </div>
  );
}

/** One side of a lever, from the centre line outwards. */
function Arm({ delta, pos }: { delta: number; pos: (d: number) => number }) {
  if (Math.abs(delta) < 0.005) return null;
  const a = pos(0);
  const b = pos(delta);
  return (
    <span
      className="tor-bar"
      data-dir={delta > 0 ? "up" : "down"}
      style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
    />
  );
}
