"use client";

/**
 * Six analyses in the space one of them used to take.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT WAS WRONG                                                           │
 * │                                                                          │
 * │ Everything below the comparison was stacked: the ruler at 2243px, the    │
 * │ transit alternative at 2429, the split at 2590, the hour-ahead forecast  │
 * │ at 2737. Each one is work somebody did carefully and each one was past   │
 * │ the point where anybody scrolls. The page was 3371px tall and its best   │
 * │ ideas were in the last third of it.                                      │
 * │                                                                          │
 * │ Stacking is the right default for things a reader must see in order.     │
 * │ These are not that — they are six answers to six unrelated questions,    │
 * │ and a reader wants one of them. That is a deck, not a column.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── Why the panels mount when they are picked ──────────────────────────────
 *
 * Two of these fetch, and one of them re-runs the fare engine a few hundred
 * times server-side. Mounting all six on load would put that work on the
 * critical path to save a click nobody asked to skip.
 *
 * So a panel mounts the first time its tab is chosen — and then *stays*
 * mounted, hidden, so going back is instant and nothing refetches. Choosing
 * the tab is also a better load trigger than the old one: the forecast used
 * to wait for the reader to scroll 2700px and stop moving, which on a page
 * this long meant most readers never saw it at all.
 */

import { useCallback, useLayoutEffect, useRef } from "react";

import { AlternativesRow } from "./alternatives-row";
import { DepartureStrip } from "./departure-strip";
import { FareCompositionPanel } from "./fare-composition";
import { PartyPanel } from "./party-panel";
import { PriceAxis } from "./price-axis";
import { ReturnLeg } from "./return-leg";
import { SensitivityStrip } from "./sensitivity-panel";
import { TradeoffLedger } from "./tradeoff-ledger";
import { openPanel, usePanel } from "./use-panel";

import { PANELS as TABS, type PanelId as TabId } from "@/lib/domain/panels";
import { RATE_CARD_VERIFIED_ON } from "@/lib/sources/ratecard/freshness";
import { MODEL_VERSION } from "@/lib/sources/ratecard/model-params";
import type { NormalizedQuote, QuoteSession } from "@/lib/domain/types";

export function InsightsDeck({
  quotes,
  session,
  showProducts,
}: {
  quotes: readonly NormalizedQuote[];
  session: QuoteSession | null;
  showProducts?: ReadonlySet<string>;
}) {
  /*
   * The open panel lives in the URL, not here.
   *
   * Three other things want to open one — the command palette, the assistant,
   * and a link somebody was sent — and only one of them could be served by a
   * setter passed down from the deck's parent. See use-panel.ts.
   *
   * `opened` is every panel opened this page load, so switching back neither
   * refetches nor reflows. It is module-level for the same reason the active
   * panel is: a panel the palette opened counts as opened.
   */
  const { active: activeId, opened } = usePanel("spread");
  const active = (TABS.find((t) => t.id === activeId)?.id ?? "spread") as TabId;
  const choose = useCallback((id: TabId) => openPanel(id), []);

  /*
   * Roving focus without an array of refs.
   *
   * The obvious implementation collects a ref per tab during render, which
   * the React Compiler rejects outright — and rightly: those closures capture
   * a render's refs and outlive it. The tablist is already in the DOM and
   * already knows its own children.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const delta =
        event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? -1
            : event.key === "Home"
              ? -TABS.length
              : event.key === "End"
                ? TABS.length
                : 0;
      /* A digit jumps straight to its tab. The strip already has focus for
         the arrows to work, so this costs one branch and no new listener. */
      if (delta === 0) {
        const digit = Number(event.key);
        if (!Number.isInteger(digit) || digit < 1 || digit > TABS.length) return;
        event.preventDefault();
        const tab = TABS[digit - 1]!;
        choose(tab.id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[digit - 1]?.focus();
        return;
      }
      event.preventDefault();
      const from = TABS.findIndex((t) => t.id === active);
      const next = Math.max(0, Math.min(TABS.length - 1, from + delta));
      const tab = TABS[next]!;
      choose(tab.id);
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]");
      buttons[next]?.focus();
    },
    [active, choose],
  );

  /*
   * The indicator, measured.
   *
   * It used to be `width: 100%/n` and `translateX(i * 100%)`, which is exact
   * arithmetic about a grid whose columns were equal — and they stopped being
   * equal the moment the columns were told to fit their labels instead of
   * overlapping them. "TRADE-OFFS" needs 84px of mono and an equal eighth of
   * this strip gives it 68, so its last letters were printed underneath the
   * keyboard hint.
   *
   * A layout effect rather than a render-time read, and a ResizeObserver
   * rather than a window listener, because the strip changes width when the
   * results column does and when the mono face finishes loading, neither of
   * which is a resize of the window.
   */
  const tablist = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = tablist.current;
    if (!strip) return;
    const place = () => {
      const tab = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!tab) return;
      strip.style.setProperty("--deck-w", `${tab.offsetWidth}px`);
      strip.style.setProperty("--deck-x", `${tab.offsetLeft}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [active]);

  if (quotes.length === 0) return null;
  const current = TABS.find((t) => t.id === active)!;
  const sessionId = session?.id ?? null;
  /* What the return leg is measured against: the cheapest on screen now. */
  const outbound = quotes.reduce<NormalizedQuote | null>(
    (best, q) => (best === null || q.rankingPriceMinor < best.rankingPriceMinor ? q : best),
    null,
  );

  return (
    <section className="deck" aria-labelledby="deck-heading">
      <div className="deck-head">
        <h2 id="deck-heading" className="section-label">
          Look closer
        </h2>
        {/* The active tab's question, so the panel below always has a subject. */}
        <p className="deck-question">{current.question}</p>
      </div>

      {/*
        Two elements, because the strip scrolls sideways on a narrow screen
        and the indicator is positioned as a percentage. A percentage inside
        the scrolling box resolves against what is *visible*, which puts the
        indicator under the wrong tab the moment the strip overflows; inside
        the grid it resolves against the full row.
      */}
      <div className="deck-tabstrip">
        <div
          ref={tablist}
          className="deck-tabs"
          role="tablist"
          aria-label="Ways to look at this comparison"
          onKeyDown={onKeyDown}
          /*
           * --deck-i and --deck-n place the indicator by arithmetic, which is
           * correct on the first frame and correct while the columns are
           * equal. They are no longer equal — see .deck-tabs in globals.css —
           * so the effect above overwrites both with measured pixels as soon
           * as there is a layout to measure. Server-rendered HTML keeps the
           * arithmetic, which is close, rather than a bar of zero width.
           */
          style={
            {
              "--deck-i": TABS.findIndex((t) => t.id === active),
              "--deck-n": TABS.length,
            } as React.CSSProperties
          }
        >
          <span className="deck-indicator" aria-hidden />
          {TABS.map((tab, i) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`deck-tab-${tab.id}`}
              className="deck-tab"
              aria-selected={tab.id === active}
              aria-controls={`deck-panel-${tab.id}`}
              tabIndex={tab.id === active ? 0 : -1}
              /* The digit that selects it, revealed on hover or focus. */
              data-key={i + 1}
              onClick={() => choose(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {TABS.map((tab) =>
        tab.id === active || opened.has(tab.id) ? (
          <div
            key={tab.id}
            className="deck-panel"
            role="tabpanel"
            id={`deck-panel-${tab.id}`}
            aria-labelledby={`deck-tab-${tab.id}`}
            hidden={tab.id !== active}
            /* Reachable by keyboard: a panel with no focusable child still
               has to be somewhere Tab can land, or its content is stranded. */
            tabIndex={0}
          >
            {tab.id === "spread" ? <PriceAxis quotes={quotes} embedded /> : null}
            {tab.id === "breakdown" ? <FareCompositionPanel quotes={quotes} /> : null}
            {tab.id === "whatif" ? (
              <SensitivityStrip sessionId={sessionId} quoteIds={quotes.map((q) => q.id)} />
            ) : null}
            {tab.id === "tradeoffs" ? <TradeoffLedger quotes={quotes} /> : null}
            {tab.id === "timing" ? (
              <DepartureStrip sessionId={sessionId} showProducts={showProducts} embedded />
            ) : null}
            {tab.id === "split" ? (
              <PartyPanel quotes={quotes} seatPool={session?.quotes ?? quotes} embedded />
            ) : null}
            {tab.id === "return" ? (
              session ? (
                <ReturnLeg session={session} outbound={outbound} outboundAll={quotes} />
              ) : (
                /* No panel may render blank — see insights-deck.spec.ts. */
                <p className="deck-empty muted">
                  The return leg needs a comparison to reverse. Run one and it will price itself.
                </p>
              )
            ) : null}
            {tab.id === "transit" ? <AlternativesRow sessionId={sessionId} embedded /> : null}
          </div>
        ) : null,
      )}
      {/*
        The instrument's own plate.

        Four figures the session already carries: nothing here is computed for
        display and nothing is estimated. `sourcesSucceeded` over
        `sourcesExpected` is the honest pair rather than a count — a run where
        one source failed prints 3/4, which is the thing worth knowing.

        It also gives the thinnest panels a floor to end on. Measured against
        the 420px reserve, Transit fills 88px; this reclaims 52 of the 332
        that were left over. The rest is a content problem and is left visible
        rather than padded.
      */}
      <p className="deck-plate">
        <span>
          Model <b>{MODEL_VERSION}</b>
        </span>
        <span>
          Rate cards <b>{RATE_CARD_VERIFIED_ON}</b>
        </span>
        {session ? (
          <span>
            Sources{" "}
            <b>
              {session.coverage.sourcesSucceeded.length}/{session.coverage.sourcesExpected.length}
            </b>
          </span>
        ) : null}
        <span>
          Options <b>{quotes.length}</b>
        </span>
      </p>
    </section>
  );
}
