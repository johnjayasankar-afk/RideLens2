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

import { useCallback, useState } from "react";

import { openPanel } from "./use-panel";
import { useWhenStill } from "./use-when-still";
import { loadSensitivity, useSensitivity } from "./use-sensitivity";

import { formatMoneyMinor } from "@/lib/domain/money";
import type { SensitivityReport } from "@/lib/domain/sensitivity";

/**
 * The chart, once the report the console already asked for arrives.
 *
 * The fetch lives in `use-sensitivity.ts` because two places read the same
 * answer: this, and the one line of it the console shows above the fold. By
 * the time a reader opens this tab the request has usually already been made
 * and the panel draws immediately.
 */
export function SensitivityStrip({
  sessionId,
  quoteIds,
}: {
  sessionId: string | null;
  /**
   * The ids of the options currently on screen.
   *
   * Part of the cache key as well as the request: a comparison filtered to
   * Standard shows three of six, and "the cheapest stays cheapest" is a
   * different claim about each set.
   */
  quoteIds: readonly string[];
}) {
  const loaded = useSensitivity(sessionId, quoteIds);
  const load = useCallback(() => {
    if (sessionId) loadSensitivity(sessionId, quoteIds);
  }, [sessionId, quoteIds]);

  useWhenStill(null, Boolean(sessionId), load, { deadlineMs: Infinity });

  if (!sessionId) return null;
  if (loaded.state === "idle" || loaded.state === "loading") {
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

/** A delta as a reader would say it, including when it is not one. */
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

/**
 * The one line of the report that belongs above the fold.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ "3 of 8 scenarios change which option is cheapest" is a warning about    │
 * │ the recommendation this page is making. Behind a tab it is a curiosity;  │
 * │ beside the takeaway it is the sentence that should change what somebody  │
 * │ does. Burying it would repeat the mistake the deck was built to fix.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Reserved rather than revealed: the chip occupies its slot from the first
 * paint whether or not the report has landed, because arriving into the
 * console's status row is arriving on top of everything a reader is reading.
 * It shares the fetch with the panel — see use-sensitivity.ts — so showing it
 * costs nothing the tab did not already cost.
 */
export function RobustnessChip({
  sessionId,
  quoteIds,
}: {
  sessionId: string | null;
  quoteIds: readonly string[];
}) {
  const loaded = useSensitivity(sessionId, quoteIds);
  const load = useCallback(() => {
    if (sessionId) loadSensitivity(sessionId, quoteIds);
  }, [sessionId, quoteIds]);

  useWhenStill(null, Boolean(sessionId), load, { deadlineMs: Infinity });

  if (loaded.state !== "ready") return null;
  const { ranking, subject } = loaded.report;

  return (
    <button
      type="button"
      className="robust"
      data-stable={ranking.stable ? "true" : "false"}
      onClick={() => {
        openPanel("whatif");
        window.requestAnimationFrame(() => {
          document.querySelector(".deck")?.scrollIntoView({ block: "center" });
        });
      }}
      title={
        ranking.stable
          ? `${subject} is the cheapest under all ${ranking.tested} scenarios tested.`
          : ranking.upsets.join(" · ")
      }
    >
      {/* Short, because it is a cell in a status strip. The whole sentence is
          on the title, and the panel a click away says it in full. */}
      {ranking.stable
        ? `Order holds ${ranking.tested}/${ranking.tested}`
        : `Order flips ${ranking.upsets.length}/${ranking.tested}`}
    </button>
  );
}
