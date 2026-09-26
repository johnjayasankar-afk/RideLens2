"use client";

/**
 * The next hour, drawn as bands.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Everything else on this page answers "what does it cost now". This is    │
 * │ the one question a model is better placed to answer than a partner API,  │
 * │ because nobody can quote a ride that has not happened yet.                │
 * │                                                                          │
 * │ Which is exactly why it has to be drawn carefully. A line would read as  │
 * │ a prediction. The band is the honest object — it is what the model       │
 * │ actually produces — so the band is what gets ink, and it visibly fattens │
 * │ toward the right-hand edge because an hour out we know less.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The centre line is deliberately faint and unlabelled. It exists so the eye
 * can follow the shape, not so anyone reads a number off it; every figure
 * printed here is a range.
 */

import { useCallback, useRef, useState } from "react";

import { useWhenStill } from "./use-when-still";

import type { DepartureWindow, ProviderForecast } from "@/lib/domain/departure-window";
import { formatMoneyMinor } from "@/lib/domain/money";

type Loaded =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "empty"; reason: string }
  | { state: "ready"; window: DepartureWindow }
  | { state: "failed" };

const W = 320;
const H = 58;
const PAD_Y = 6;

function bandPath(f: ProviderForecast): { band: string; centre: string } {
  const pts = f.points;
  const lows = pts.map((p) => p.lowMinor);
  const highs = pts.map((p) => p.highMinor);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(1, max - min);

  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * W;
  const y = (v: number) => PAD_Y + (1 - (v - min) / span) * (H - PAD_Y * 2);

  const top = pts.map(
    (p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.highMinor).toFixed(1)}`,
  );
  const bottom = [...pts]
    .map((p, i) => ({ p, i }))
    .reverse()
    .map(({ p, i }) => `L${x(i).toFixed(1)},${y(p.lowMinor).toFixed(1)}`);
  const centre = pts.map(
    (p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.centerMinor).toFixed(1)}`,
  );

  return { band: [...top, ...bottom, "Z"].join(" "), centre: centre.join(" ") };
}

function providerName(f: ProviderForecast): string {
  const p = f.provider;
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function DepartureStrip({
  sessionId,
  showProducts,
}: {
  sessionId: string | null;
  /**
   * The `provider:product` pairs currently on screen above.
   *
   * The endpoint projects everything the session priced, which is six rows
   * even when the comparison is filtered to three. A strip that answers a
   * question about options the rider has filtered away is just noise under
   * the thing they were reading.
   */
  showProducts?: ReadonlySet<string>;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const askedFor = useRef<string | null>(null);

  /*
   * Fetched when it comes into view and the page has stopped moving.
   *
   * Projecting every provider across the horizon is a couple of hundred runs
   * of the fare engine, and the response lands as a React update over three
   * SVGs. Doing that while somebody is scrolling took the 95th-percentile
   * frame from 9 ms to 475 ms — caught by `npm run perf`, not by eye.
   */
  const load = useCallback(() => {
    if (!sessionId || askedFor.current === sessionId) return;
    askedFor.current = sessionId;
    setLoaded({ state: "loading" });
    fetch(`/api/forecast?session=${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { window: DepartureWindow | null; reason?: string }) => {
        if (!body.window) {
          setLoaded({ state: "empty", reason: body.reason ?? "Nothing here can be projected." });
          return;
        }
        setLoaded({ state: "ready", window: body.window });
      })
      .catch(() => setLoaded({ state: "failed" }));
  }, [sessionId]);

  /*
   * No deadline. The map forces itself in eventually because a rider expects
   * to see a map; nobody is waiting on this, and forcing it mid-scroll cost
   * 46 fps and a 142 ms 95th-percentile frame. It loads when the page is
   * still, which is when somebody is actually looking at it.
   */
  useWhenStill(hostRef, Boolean(sessionId), load, { deadlineMs: Infinity });

  if (!sessionId) return null;

  return (
    <section className="departure" ref={hostRef} aria-labelledby="departure-heading">
      <div className="departure-head">
        <h2 id="departure-heading">Does waiting help?</h2>
        {/*
          Not a caption anyone can miss. The strip below is the only thing in
          the product that describes a time that has not happened, and it has
          to carry its own label rather than rely on one further up the page.
        */}
        <span className="departure-tag">Model projection · not a quote</span>
      </div>

      {loaded.state === "ready" ? (
        <>
          <p className="departure-advice" data-kind={loaded.window.advice.kind}>
            {loaded.window.advice.sentence}
          </p>

          <div className="departure-rows">
            {loaded.window.forecasts
              .filter((f) => !showProducts || showProducts.has(`${f.provider}:${f.product}`))
              .map((f) => {
                const { band, centre } = bandPath(f);
                const first = f.points[0]!;
                const last = f.points.at(-1)!;
                return (
                  <div className="departure-row" key={`${f.provider}:${f.product}`}>
                    <div className="departure-label">
                      <strong>{providerName(f)}</strong>
                      <span className="muted">{f.product.replace(/_/g, " ")}</span>
                    </div>
                    <svg
                      className="departure-chart"
                      viewBox={`0 0 ${W} ${H}`}
                      preserveAspectRatio="none"
                      role="img"
                      aria-label={`${providerName(f)} ${f.product}: modeled ${formatMoneyMinor(first.lowMinor)} to ${formatMoneyMinor(first.highMinor)} leaving now, and ${formatMoneyMinor(last.lowMinor)} to ${formatMoneyMinor(last.highMinor)} in an hour. The range widens with time because the model knows less further ahead.`}
                    >
                      <path className="departure-band" d={band} />
                      <path className="departure-centre" d={centre} />
                    </svg>
                    <div className="departure-ends">
                      <span>
                        {formatMoneyMinor(first.lowMinor)}–{formatMoneyMinor(first.highMinor)}
                      </span>
                      <span className="muted">now</span>
                      <span className="departure-arrow" aria-hidden>
                        →
                      </span>
                      <span>
                        {formatMoneyMinor(last.lowMinor)}–{formatMoneyMinor(last.highMinor)}
                      </span>
                      <span className="muted">+{loaded.window.horizonMinutes}m</span>
                    </div>
                  </div>
                );
              })}
          </div>

          <p className="departure-foot muted">
            The band widens toward the right because a projection an hour out is worth less than one
            for now. A later window is only ever called cheaper when its range clears today&rsquo;s
            entirely — most of the time it does not, and this says so. Model{" "}
            {loaded.window.modelVersion}.
          </p>
        </>
      ) : loaded.state === "empty" ? (
        <p className="departure-foot muted">{loaded.reason}</p>
      ) : loaded.state === "failed" ? (
        <p className="departure-foot muted">
          The projection could not be built. The comparison above is unaffected.
        </p>
      ) : (
        <div className="departure-rows" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div className="departure-row" key={i}>
              <div className="departure-label">
                <span className="sk-line w60" />
              </div>
              <span className="sk-line departure-chart" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
