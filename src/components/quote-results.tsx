"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Freshness,
  NormalizedQuote,
  QuoteSession,
  RankingMode,
  RideCategory,
} from "@/lib/domain/types";
import { formatQuotePrice, formatMoneyMinor, quoteTypeLabel } from "@/lib/domain/money";
import {
  CONFIDENCE_STEPS,
  confidenceLabel,
  confidenceStep,
  decayedConfidence,
} from "@/lib/domain/confidence";
import {
  freshnessLabel,
  freshnessStatus,
  computeFreshness,
  expiryCountdown,
} from "@/lib/domain/freshness";
import { categoryLabel } from "@/lib/domain/taxonomy";
import { comparePrices, rankQuotes } from "@/lib/domain/ranking";
import { withTransition } from "@/lib/view-transition";
import { computeSavings, defaultBaseline, joinSentences } from "@/lib/domain/savings";
import { ProviderLogo } from "@/components/provider-logo";
import { Assistant } from "@/components/assistant";
import { RouteStanding } from "@/components/route-standing";
import { makeWatch } from "@/lib/history/price-watch";
import type { AssistantAction } from "@/lib/assistant/actions";
import { PriceWatchControl } from "@/components/price-watch-control";
import { usePriceWatches } from "@/components/use-price-watch";
import { evaluateWatch } from "@/lib/history/price-watch";
import { cheapestLowMinor, routeKeyFor } from "@/lib/history/trip-log";
import { noteChoice, useTripLog } from "@/components/use-trip-log";
import type { PredictionClaim } from "@/lib/eval/report-proof";
import { MODEL_VERSION } from "@/lib/sources/ratecard/model-params";
import { ProvenanceChip } from "@/components/provenance-chip";
import { provenanceOf } from "@/lib/domain/provenance";
import { explainWinner } from "@/lib/domain/why-this-one";
import { InsightsDeck } from "./insights-deck";
import { RobustnessChip } from "./sensitivity-panel";
import { openPanel } from "./use-panel";
import { WalkSuggestionCard } from "./walk-suggestion";
import { useCountUpRange } from "./use-count-up";
import { RouteMap, type MapRoute } from "@/components/route-map";
import type { PlaceValue } from "@/components/place-field";

function liveFreshness(q: NormalizedQuote, now: Date): Freshness {
  return computeFreshness(q.receivedAt, q.expiresAt, now);
}

function freshnessLine(q: NormalizedQuote, now = new Date()): string {
  const fresh = liveFreshness(q, now);
  const status = freshnessStatus(fresh);
  const age = freshnessLabel(fresh, q.receivedAt, now);
  if (age === "just now") return status;
  return `${status} · ${age}`;
}

function statusDotClass(q: NormalizedQuote, now = new Date()): string {
  const status = freshnessStatus(liveFreshness(q, now));
  if (status === "Fresh") return "status-dot is-fresh";
  if (status === "Recent") return "status-dot is-recent";
  if (status === "Expired") return "status-dot is-expired";
  return "status-dot is-aging";
}

function humanizeSourceId(sourceId: string): string {
  const lower = sourceId.toLowerCase();
  if (lower.includes("uber")) return "Uber";
  if (lower.includes("lyft")) return "Lyft";
  if (lower.includes("empower") || lower.includes("obi")) return "Empower";
  if (lower.includes("curb")) return "Curb";
  if (lower.includes("rate")) return "Rate cards";
  return sourceId.replace(/[_-]+/g, " ");
}

function formatTripMins(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 1) return "<1 min";
  return `~${m} min`;
}

function formatClock(from: Date, addSeconds: number): string {
  const d = new Date(from.getTime() + addSeconds * 1000);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function providerLabel(q: NormalizedQuote): string {
  return q.provider.charAt(0).toUpperCase() + q.provider.slice(1);
}

function formatWaitRange(
  mid: number | null | undefined,
  low?: number | null,
  high?: number | null,
): string {
  if (mid == null) return "—";
  if (low != null && high != null && high > low) {
    const lo = Math.max(1, Math.round(low / 60));
    const hi = Math.max(lo, Math.round(high / 60));
    if (lo === hi) return `~${lo} min`;
    return `${lo} to ${hi} min`;
  }
  return formatTripMins(mid);
}

function heroTitle(mode: RankingMode): string {
  if (mode === "fastest") return "Soonest";
  if (mode === "best_value") return "Best value";
  return "Best price";
}

function humanizeDemand(raw: string | undefined): string | null {
  if (!raw) return null;
  const base = (raw.split("+")[0] || raw).split("|")[0] || raw;
  const map: Record<string, string> = {
    late_night: "Late night",
    morning_peak: "Morning peak",
    morning: "Morning commute",
    am_commute: "Morning commute",
    evening_peak: "Evening peak",
    evening: "Evening commute",
    pm_commute: "Evening commute",
    midday: "Midday",
    overnight: "Overnight",
    overnight_supply: "Overnight (thin supply)",
    weekend: "Weekend",
    weekend_day: "Weekend day",
    weekend_night: "Weekend night",
    sunday_return: "Sunday return",
    flat_fare: "Flat fare",
    baseline: "Steady market",
    off_peak: "Off-peak",
  };
  const key = base
    .replace(/\+tick\d+.*$/, "")
    .replace(/heat\d+pct/, "")
    .trim();
  const mapped = map[key];
  if (mapped) return mapped;
  if (key.includes("am_commute") || key.includes("morning")) return "Morning commute";
  if (key.includes("pm_commute") || key.includes("evening")) return "Evening commute";
  if (key.includes("weekend_night")) return "Weekend night";
  if (key.includes("night")) return "Late night";
  return key.replace(/_/g, " ");
}

function marketTone(mult: number | undefined): {
  label: string;
  className: string;
} {
  if (mult == null || !Number.isFinite(mult)) {
    return { label: "Market steady", className: "market-chip is-calm" };
  }
  if (mult >= 1.35) return { label: "Market hot", className: "market-chip is-hot" };
  if (mult >= 1.15) return { label: "Elevated demand", className: "market-chip is-warm" };
  if (mult <= 0.98) return { label: "Soft market", className: "market-chip is-calm" };
  return { label: "Market steady", className: "market-chip is-calm" };
}

/*
 * This used to publish a percentage — `100 - band * 900`, clamped to 55–94 —
 * beside a filling bar. It was a rescaled band width wearing the costume of a
 * calibrated probability, and docs/CALIBRATION.md says plainly that the model
 * has never been scored against a real fare. There is nothing to put a number
 * on yet, so it shows the class, what the class rests on, and what age has
 * already cost it.
 */
function ConfidenceMeter({ quote, now }: { quote: NormalizedQuote; now: Date }) {
  const decayed = decayedConfidence(quote, now);
  const band = quote.metadata?.band as number | undefined;
  const on = confidenceStep(decayed.class);

  return (
    <div
      className="confidence"
      data-decayed={decayed.steps > 0 ? "true" : "false"}
      aria-label={`${confidenceLabel(decayed.class)}${decayed.reason ? `. ${decayed.reason}` : ""}`}
    >
      <div className="confidence-meta">
        <span>{confidenceLabel(decayed.class)}</span>
        {decayed.steps > 0 ? (
          <span className="muted">was {confidenceLabel(decayed.base).toLowerCase()}</span>
        ) : null}
      </div>
      <div className="confidence-steps" aria-hidden>
        {Array.from({ length: CONFIDENCE_STEPS }, (_, i) => (
          <span key={i} className="confidence-step" data-on={i < on ? "true" : "false"} />
        ))}
      </div>
      {band != null ? (
        <p className="confidence-basis">
          Based on a ±{(band * 100).toFixed(1)}% band, not on measured accuracy.
        </p>
      ) : null}
      {decayed.reason ? <p className="confidence-reason">{decayed.reason}</p> : null}
    </div>
  );
}

function humanizeFeeKey(key: string): string {
  if (key.startsWith("toll_")) {
    return `Toll · ${key.slice(5).replace(/_/g, " ")}`;
  }
  const map: Record<string, string> = {
    base: "Base fare",
    per_mile: "Distance",
    per_minute: "Time",
    booking_fee: "Booking fee",
    black_car_fund: "Black car fund",
    sales_tax: "Sales tax",
    congestion: "Congestion",
    airport_fee: "Airport fee",
    marketplace_rules: "Marketplace fees",
    directional_asymmetry: "Direction lift",
    out_of_town_factor: "Out-of-town factor",
    weather_lift: "Weather lift",
    min_fare: "Minimum fare",
  };
  return map[key] || key.replace(/_/g, " ");
}

/**
 * The price, counting up.
 *
 * Formats from the animated numbers rather than animating a formatted
 * string, so the currency, the separator and the range shape all stay
 * exactly what formatQuotePrice would have produced — the last frame is
 * identical to the static render, not merely similar.
 */
function CountingPrice({ quote, animate }: { quote: NormalizedQuote; animate: boolean }) {
  const isRange =
    quote.priceType === "ESTIMATE_RANGE" || quote.priceMinMinor !== quote.priceMaxMinor;
  const { low, high } = useCountUpRange(
    isRange ? quote.priceMinMinor : quote.displayPriceMinor,
    isRange ? quote.priceMaxMinor : quote.displayPriceMinor,
    { enabled: animate },
  );

  const settled = formatQuotePrice(quote);
  if (!animate) return <>{settled}</>;

  /* Rounded to whole cents every frame: a price never shows a fraction. */
  const shown: NormalizedQuote = {
    ...quote,
    priceMinMinor: Math.round(low),
    priceMaxMinor: Math.round(high),
    displayPriceMinor: Math.round(isRange ? low : high),
  };
  return <>{formatQuotePrice(shown)}</>;
}

function FeeBreakdown({ quote, now }: { quote: NormalizedQuote; now: Date }) {
  const fees = quote.metadata?.feeBreakdown as Record<string, number> | undefined;
  const center = quote.metadata?.centerFare as number | undefined;
  const band = quote.metadata?.band as number | undefined;
  const city = quote.metadata?.city as string | undefined;
  const demand = humanizeDemand(quote.metadata?.demand as string | undefined);
  const demandMult = quote.metadata?.demandCenter as number | undefined;
  const weather = quote.metadata?.weather as string | undefined;
  const tone = marketTone(demandMult);
  const anchor = quote.metadata?.anchorId as string | undefined;
  const methodology = quote.metadata?.methodology as string | undefined;

  if (!fees && center == null) return null;

  return (
    <details className="fee-breakdown">
      <summary>How this was estimated</summary>
      <div className="fee-body">
        {center != null ? (
          <p>
            Center <strong>{formatMoneyMinor(Math.round(center * 100))}</strong>
            {band != null ? <span className="muted"> (±{(band * 100).toFixed(1)}%)</span> : null}
          </p>
        ) : null}
        <ConfidenceMeter quote={quote} now={now} />
        {city ? <p className="muted">Market: {city}</p> : null}
        {demand ? (
          <p className="muted">
            Demand: {demand}
            {demandMult != null ? ` · ×${demandMult.toFixed(2)}` : ""}
          </p>
        ) : null}
        {weather && !weather.startsWith("dry") ? <p className="muted">Weather: {weather}</p> : null}
        {anchor ? <p className="muted">Corridor: {anchor.replace(/_/g, " ")}</p> : null}
        <p className="muted">
          <span className={tone.className}>{tone.label}</span>
        </p>
        {fees && Object.keys(fees).length > 0 ? (
          <ul>
            {Object.entries(fees).map(([k, v]) => {
              const isFactor = /factor|asymmetry/i.test(k);
              return (
                <li key={k}>
                  <span>{humanizeFeeKey(k)}</span>
                  <span>
                    {isFactor
                      ? `×${Number(v).toFixed(2)}`
                      : formatMoneyMinor(Math.round(Number(v) * 100))}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {methodology ? <p className="muted fine">{methodology}</p> : null}
      </div>
    </details>
  );
}

function QuoteCard({
  quote,
  hero,
  deltaMinor,
  waitDeltaSec,
  index = 0,
  now,
  sessionId,
  animate = true,
}: {
  quote: NormalizedQuote;
  hero?: boolean;
  deltaMinor?: number;
  waitDeltaSec?: number;
  sessionId?: string;
  index?: number;
  now: Date;
  animate?: boolean;
}) {
  const handoff = quote.bookingHandoff;
  const dollarsPerMile =
    quote.distanceMeters && quote.distanceMeters > 0
      ? quote.rankingPriceMinor / 100 / (quote.distanceMeters / 1609.344)
      : null;

  const pickupSec = quote.pickupEtaSeconds;
  const waitLow = quote.metadata?.waitLowSeconds as number | undefined;
  const waitHigh = quote.metadata?.waitHighSeconds as number | undefined;
  const driveSec = quote.tripDurationSeconds;
  const totalSec = pickupSec != null && driveSec != null ? pickupSec + driveSec : null;
  const arriveLabel = totalSec != null ? formatClock(now, totalSec) : "—";

  /*
   * Opaque ids only. The addresses used to travel in the query string, which
   * puts a rider's origin and destination into every proxy access log and
   * their browser history; /book resolves them from the session instead.
   */
  const bookParams = new URLSearchParams({ provider: quote.provider });
  if (sessionId) bookParams.set("s", sessionId);
  bookParams.set("q", quote.id);
  if (handoff?.url) bookParams.set("url", handoff.url);
  /*
   * No returnTo. It carried the full deep link — "/?from=40.75,-73.98,Midtown
   * &to=..." — so the addresses were still in the /book URL, one level down,
   * after being taken out of the top level. /book goes back through browser
   * history instead, which costs nothing and restores exactly where the rider
   * was.
   */
  const prefillsTrip =
    Boolean(handoff?.prefills?.pickup) && Boolean(handoff?.prefills?.destination);
  if (!prefillsTrip) bookParams.set("prefills", "0");

  // Always hand off through /book so every provider gets the same confirm step.
  const bookHref = `/book?${bookParams.toString()}`;
  const bookLabel = !prefillsTrip
    ? `Open ${providerLabel(quote)}`
    : handoff?.label || `Continue with ${providerLabel(quote)}`;

  const demandMult = quote.metadata?.demandCenter as number | undefined;
  const tone = marketTone(demandMult);
  const weatherRaw = String(quote.metadata?.weather || "");
  const showWeather =
    weatherRaw && !weatherRaw.startsWith("dry") && !weatherRaw.startsWith("unavailable");
  const expiry = expiryCountdown(quote.expiresAt, now);

  return (
    <article
      className={`quote-card${hero ? " hero" : ""}${animate ? " reveal-card" : ""}`}
      style={{
        ...(animate ? { animationDelay: `${Math.min(index, 8) * 45}ms` } : null),
        /*
         * The name that makes the re-sort a re-sort.
         *
         * `withTransition` has been feature-detected and reduced-motion-gated
         * since the ranking controls were built, and its comment says "the
         * same card is visibly the same card in a new place" — but no element
         * in the app ever carried a `view-transition-name`, so the browser
         * snapshotted the whole root as one bitmap and crossfaded it. The
         * mechanism was wired at both ends and connected to nothing.
         *
         * One stable name per quote, so when the ranking or the filter moves
         * a row the browser tweens that row from where it was to where it is
         * instead of dissolving the page. Costs nothing per frame: a snapshot
         * is taken once per discrete action, never during a scroll.
         */
        viewTransitionName: transitionName(quote),
      }}
    >
      <header className="quote-card-header">
        <ProviderLogo provider={quote.provider} size={40} priority={Boolean(hero)} />
        <div className="quote-identity">
          <p className="provider">{providerLabel(quote)}</p>
          <p className="product">{quote.providerProductName}</p>
          <ProvenanceChip quote={quote} />
        </div>
        <div className="price-block">
          {/*
            The settled figure is the accessible name from the first frame,
            and the animated text is hidden from assistive tech. Nobody is
            read a number that is on its way somewhere.
          */}
          <p className="price" aria-label={`Price ${formatQuotePrice(quote)}`}>
            <span aria-hidden>
              <CountingPrice quote={quote} animate={animate} />
            </span>
          </p>
          {dollarsPerMile != null ? (
            <p className="per-mile muted">${dollarsPerMile.toFixed(2)}/mi</p>
          ) : null}
        </div>
      </header>

      <div className="wait-row" aria-label="Trip timing">
        <div className="wait-cell">
          <span className="wait-label">Pickup</span>
          <span className="wait-value">{formatWaitRange(pickupSec, waitLow, waitHigh)}</span>
        </div>
        <div className="wait-cell">
          <span className="wait-label">Drive</span>
          <span className="wait-value">{formatTripMins(driveSec)}</span>
        </div>
        <div className="wait-cell">
          <span className="wait-label">Total</span>
          <span className="wait-value">{formatTripMins(totalSec)}</span>
        </div>
        <div className="wait-cell">
          <span className="wait-label">Arrive</span>
          <span className="wait-value">{arriveLabel}</span>
        </div>
      </div>

      <div className="meta-chips">
        <span className="meta-chip">{categoryLabel(quote.normalizedCategory)}</span>
        <span className="meta-chip">{quoteTypeLabel(quote.priceType)}</span>
        <span className={`meta-chip ${tone.className}`}>{tone.label}</span>
        {showWeather ? <span className="meta-chip market-chip is-rain">Weather lift</span> : null}
        {/*
          The reserve is on the slot, not on the pill.
          ──────────────────────────────────────────
          Reserving width on the chip itself held the row open — which was the
          point, the text grows from "Fresh" to "Fresh · 47 sec ago" a few
          seconds after the prices land and used to wrap the row — but the
          chip is the element that paints a background, so the app drew a
          153px pill with 42px of word in it and twelve characters of empty
          grey after it. Once per card, six or seven times a screen.

          An unpainted wrapper holds the same width and the pill hugs its
          text, so the row's wrap decision is still made on the first frame
          and nothing paints emptiness.
        */}
        <span className="freshness-slot">
          <span className="meta-chip freshness">
            <span className={statusDotClass(quote, now)} aria-hidden />
            {freshnessLine(quote, now)}
          </span>
        </span>
        {expiry && liveFreshness(quote, now) !== "LIVE" ? (
          <span className="meta-chip muted">{expiry}</span>
        ) : null}
      </div>

      {!hero && deltaMinor != null && deltaMinor > 0 ? (
        <p className="delta muted">
          +{formatMoneyMinor(deltaMinor)} vs best
          {waitDeltaSec != null && waitDeltaSec > 30 ? (
            <span> · +{Math.round(waitDeltaSec / 60)} min wait</span>
          ) : null}
        </p>
      ) : null}

      <FeeBreakdown quote={quote} now={now} />

      <a
        className="book book-with-logo"
        href={bookHref}
        /*
          The one moment the choice is knowable. What it cost is not knowable
          for another half hour, which is why the old prompt on the handoff
          page — asked on the way out — could never be answered.
        */
        onClick={() => {
          if (!sessionId) return;
          noteChoice(sessionId, {
            quoteId: quote.id,
            provider: quote.provider,
            product: quote.providerProductName,
            lowMinor: quote.priceMinMinor,
            highMinor: quote.priceMaxMinor,
            at: new Date().toISOString(),
            claim: quote.metadata?.reportClaim as PredictionClaim | undefined,
            signature: quote.metadata?.reportSignature as string | undefined,
          });
        }}
      >
        <ProviderLogo provider={quote.provider} size={24} />
        {bookLabel}
      </a>
    </article>
  );
}

/**
 * A custom-ident the browser will accept, stable across a re-sort.
 *
 * Provider and product rather than `quote.id`: an id is regenerated on every
 * refresh, and a name that changes between the two snapshots is two different
 * elements as far as the transition is concerned — which is the crossfade
 * this exists to replace. Non-ident characters are folded out because
 * `view-transition-name` is a custom-ident, not a string.
 */
function transitionName(
  quote: Pick<NormalizedQuote, "provider" | "providerProductId" | "providerProductName">,
): string {
  /*
   * The same hedge the React key uses, and for the same reason.
   *
   * `providerProductId` is untrusted API data — `raw.product_id` for Uber,
   * `c.ride_type` for Lyft, where the schema is `z.string()`, so an empty
   * string passes validation. Two empties from one provider both fold to
   * `q-lyft-`, and the sanitiser can fold `a.b` and `a b` together as well.
   * A duplicate `view-transition-name` does not throw — `startViewTransition`
   * rejects with InvalidStateError, the DOM update still applies, and because
   * the promise is discarded it surfaces as an unhandled rejection.
   *
   * The position is deliberately NOT in this name. The whole point is that
   * the same card keeps the same name when its rank changes; adding the index
   * would rename every row that moved, which is the crossfade this exists to
   * replace.
   */
  const id = quote.providerProductId || quote.providerProductName;
  return `q-${`${quote.provider}-${id}`.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

export function QuoteResults({
  session,
  loading,
  mode,
  filter,
  onModeChange,
  onFilterChange,
  onRefresh,
  onReverseTrip,
  mapRoute,
  mapLoading,
  pickup,
  destination,
}: {
  session: QuoteSession | null;
  loading: boolean;
  mode: RankingMode;
  filter: string;
  onModeChange: (m: RankingMode) => void;
  onFilterChange: (f: "standard" | "ALL" | "XL" | "PREMIUM" | "TAXI") => void;
  onRefresh: () => void;
  onReverseTrip?: () => void;
  mapRoute: MapRoute | null;
  mapLoading: boolean;
  pickup: PlaceValue | null;
  destination: PlaceValue | null;
}) {
  const [copied, setCopied] = useState<"best" | "all" | "fail" | null>(null);
  const [now, setNow] = useState(() => new Date());
  /* Read, not written, here — the form records; this only reports. The store
     is shared, so both see the same log without passing it down. */
  const { records: tripRecords } = useTripLog();
  const priceWatches = usePriceWatches();
  /** Which session has already played its entrance. */
  const [playedEntranceId, setPlayedEntranceId] = useState<string | null>(null);
  const resultsTopRef = useRef<HTMLElement | null>(null);
  const scrolledSessionId = useRef<string | null>(null);

  useEffect(() => {
    if (!session?.quotes?.length) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [session?.id, session?.updatedAt, session?.quotes?.length]);

  /*
   * Whether this session is still playing its entrance — answered during
   * render rather than assigned by an effect. The effect below only marks it
   * finished, and does so from a timeout callback, so nothing sets state in
   * the effect body.
   */
  const animateEntrance = Boolean(session?.id) && !loading && playedEntranceId !== session?.id;

  useEffect(() => {
    const id = session?.id;
    if (!animateEntrance || !id) return;
    const t = window.setTimeout(() => setPlayedEntranceId(id), 700);
    return () => window.clearTimeout(t);
  }, [animateEntrance, session?.id]);

  useEffect(() => {
    if (!session?.id || loading) return;
    if (scrolledSessionId.current === session.id) return;
    const el = resultsTopRef.current;
    if (!el) return;
    scrolledSessionId.current = session.id;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }, [session?.id, loading]);

  const ranked = useMemo(() => {
    const raw = session?.quotes ?? [];
    const categoryFilter =
      filter === "standard" || filter === "ALL" ? filter : ([filter] as RideCategory[]);
    return rankQuotes(raw, mode, categoryFilter);
  }, [session?.quotes, mode, filter]);

  const hero = ranked[0];

  /*
   * Everything the watch control needs, derived rather than fetched. The
   * evaluation is a pure read — see price-watch.ts — so it belongs in render
   * beside the price it is about, not in an effect that would have to write.
   */
  const watchContext = useMemo(() => {
    if (!session) return null;
    const from = {
      lat: session.pickup.lat,
      lng: session.pickup.lng,
      label: session.pickup.name || session.pickup.formattedAddress.split(",")[0] || "From",
    };
    const to = {
      lat: session.destination.lat,
      lng: session.destination.lng,
      label: session.destination.name || session.destination.formattedAddress.split(",")[0] || "To",
    };
    const priced = session.quotes
      .filter((q) => q.availability !== "UNAVAILABLE")
      .map((q) => ({ lowMinor: q.priceMinMinor }));
    const low = cheapestLowMinor(priced);
    if (low === null) return null;

    const routeKey = routeKeyFor(from, to);
    const watch = priceWatches.watches.find((w) => w.routeKey === routeKey) ?? null;
    return {
      from,
      to,
      low,
      watch,
      result: watch ? evaluateWatch(watch, priced) : null,
    };
  }, [session, priceWatches.watches]);

  /*
   * The assistant proposes; this runs it. Every branch is a call the rider
   * could already make themselves — that is the whole bound on what it can
   * do, and the reason it needs no permissions of its own.
   */
  /*
   * Offered before anyone types. Drawn from the comparison in front of them
   * rather than a fixed list, so the questions are always answerable from
   * the brief.
   */
  /*
   * Four openers, chosen to be things the brief can actually answer well.
   *
   * The brief now carries each fare's composition and the trade-off ledger's
   * own sentences, so "is it worth paying more" has a grounded answer rather
   * than an invented rate — which is exactly the question a price list
   * provokes and could never settle.
   */
  const assistantSuggestions = useMemo(() => {
    const out: string[] = [];
    const second = ranked[1];
    if (second) out.push(`Is ${providerLabel(second)} worth the extra?`);
    if (hero) out.push(`Why is ${providerLabel(hero)} the cheapest here?`);
    out.push("How much of this is fees?");
    if (mapRoute || hero) out.push("Watch this trip under $40");
    return out.slice(0, 4);
  }, [hero, ranked, mapRoute]);

  const runAssistantAction = useCallback(
    (action: AssistantAction) => {
      switch (action.action) {
        case "refresh":
          onRefresh();
          return;
        case "swap":
          onReverseTrip?.();
          return;
        case "rank":
          onModeChange(action.mode);
          return;
        case "filter":
          onFilterChange(action.category);
          return;
        case "watch": {
          if (!watchContext) return;
          priceWatches.set(
            makeWatch(watchContext.from, watchContext.to, Math.round(action.threshold * 100)),
          );
          return;
        }
        case "panel": {
          /*
           * The same path the palette takes: into the URL, where the deck
           * reads it from. The assistant sits above the deck in the tree and
           * could not reach its state even if it were allowed to.
           */
          openPanel(action.panel);
          window.requestAnimationFrame(() => {
            document.querySelector(".deck")?.scrollIntoView({ block: "center" });
          });
          return;
        }
      }
    },
    [onRefresh, onReverseTrip, onModeChange, onFilterChange, watchContext, priceWatches],
  );

  /*
   * True when nothing on screen came from a provider.
   *
   * Asked of the quotes themselves rather than of configuration: a source can
   * be enabled and still return nothing, and the sentence has to describe what
   * the reader is actually looking at.
   */
  /* Built from comparePrices, so it can never claim a saving the board
     itself would refuse to assert. */
  const winnerNote = useMemo(() => explainWinner(ranked, mode), [ranked, mode]);

  const everythingModeled = ranked.length > 0 && ranked.every((q) => provenanceOf(q).modeled);
  const rest = ranked.slice(1);

  const agingQuotes = useMemo(() => {
    if (!hero) return false;
    return ranked.some((q) => {
      const f = liveFreshness(q, now);
      return f === "STALE" || f === "EXPIRED";
    });
  }, [ranked, hero, now]);

  /*
   * Seconds until the marketplace reprices, computed rather than counted down.
   *
   * This was a second interval keeping its own state in step with the first.
   * `now` already advances once a second for the freshness labels, so the
   * remaining time is just arithmetic against the moment the session was
   * quoted — one timer instead of two, and no state to drift.
   */
  const tickLeft = ((): number | null => {
    const next = hero?.metadata?.secondsToNextTick;
    if (typeof next !== "number" || !Number.isFinite(next)) return null;
    const quotedAt = session?.updatedAt ? Date.parse(session.updatedAt) : now.getTime();
    const elapsed = Number.isFinite(quotedAt) ? (now.getTime() - quotedAt) / 1000 : 0;
    return Math.max(0, Math.round(next - elapsed));
  })();

  const failures = session?.coverage.sourcesFailed ?? [];
  const expected = session?.coverage.sourcesExpected ?? [];
  const succeeded = session?.coverage.sourcesSucceeded ?? [];
  const pendingSources = expected.filter(
    (s) => !succeeded.includes(s) && !failures.some((f) => f.sourceId === s),
  );
  const isPartial =
    session?.status === "PARTIAL" || (Boolean(hero) && failures.length > 0 && succeeded.length > 0);
  const failedEmpty = Boolean(session) && !loading && (session?.quotes.length ?? 0) === 0;
  const filterEmpty =
    Boolean(session) && !loading && (session?.quotes.length ?? 0) > 0 && ranked.length === 0;

  const insight = useMemo(() => {
    if (!hero) return null;
    const baseline = defaultBaseline(hero, ranked);
    return computeSavings(hero, baseline);
  }, [hero, ranked]);

  const takeaway = useMemo(() => {
    if (!hero) return null;
    const parts: string[] = [];
    if (insight?.text) parts.push(insight.text);
    const mult = hero.metadata?.demandCenter as number | undefined;
    const tone = marketTone(mult);
    if (mult != null && mult >= 1.15) {
      parts.push(`${tone.label} right now — refresh before you book.`);
    }
    const weather = String(hero.metadata?.weather || "");
    if (weather && !weather.startsWith("dry")) {
      parts.push("Weather is lifting estimated prices.");
    }
    if (hero.provider === "empower" && rest[0]) {
      const save = rest[0].rankingPriceMinor - hero.rankingPriceMinor;
      if (save > 800) {
        parts.push(`Empower leads by ${formatMoneyMinor(save)} on this route.`);
      }
    }
    if (!parts.length) return null;
    /* Two at most, each terminated — see joinSentences. */
    return joinSentences(parts.slice(0, 2));
  }, [hero, insight, rest]);

  const tripStats = useMemo(() => {
    const q = hero || ranked[0];
    if (!q && !mapRoute) return null;
    const waits = ranked.map((x) => x.pickupEtaSeconds).filter((n): n is number => n != null);
    const drives = ranked.map((x) => x.tripDurationSeconds).filter((n): n is number => n != null);
    /*
     * The register goes through comparePrices, like everything else.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ `bestMid: hero.rankingPriceMinor` printed the MIDPOINT at the        │
     * │ largest type on the page, labelled "Best estimate", 250px above a    │
     * │ hero card that states a band and refuses to name a point.            │
     * │ docs/QUOTE_SEMANTICS.md:23 — "**Never** show a fabricated midpoint   │
     * │ to users. Midpoint/p50 is ranking-only."                             │
     * │                                                                      │
     * │ And `versusNext` was one midpoint minus another, which line 40 of    │
     * │ the same file forbids by name: "never a false precise '$X cheaper'   │
     * │ claim from a midpoint alone." It printed "SAVES VS NEXT $1.30" forty │
     * │ pixels above the app's own sentence saying the two ranges overlap so │
     * │ treat them as the same price.                                        │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * `comparePrices` is that contract, already written and already tested,
     * and the console was the one surface that went around it. A saving is
     * reported only when the bands are disjoint, where it is the gap between
     * them and a rider is guaranteed it; otherwise the cell says what the
     * relation actually is.
     */
    const against = hero && rest[0] ? comparePrices(hero, rest[0]) : null;
    return {
      miles: mapRoute?.miles ?? (q?.distanceMeters ? q.distanceMeters / 1609.344 : null),
      minWait: waits.length ? Math.min(...waits) : null,
      minDrive:
        mapRoute?.minutes != null
          ? mapRoute.minutes * 60
          : drives.length
            ? Math.min(...drives)
            : null,
      bestFrom: hero?.priceMinMinor ?? null,
      /*
       * "from" is a hedge, and a hedge on an upfront fare is its own kind of
       * dishonesty. docs/QUOTE_SEMANTICS.md:17 — an UPFRONT_QUOTE is displayed
       * as the exact amount, no "Est." — and for one of those priceMin equals
       * priceMax, so "BEST, FROM $24.80" would make the instrument look less
       * certain than it is on the one quote type it can actually stand behind.
       * Not reachable on today's fixtures, which are all modelled; the code
       * path is live.
       */
      bestIsPoint: hero != null && hero.priceMinMinor === hero.priceMaxMinor,
      versusNext:
        against?.relation === "cheaper" && against.savingsMinor ? against.savingsMinor : null,
      /*
       * One word, and it has to fit on one line.
       *
       * comparePrices' own labels — "Similar price", "Likely cheaper", "More
       * expensive" — are 84 to 110px, and the register cell's inner width is
       * 115px at 1440 and 94 at 1100. So the cell grew from one line to two
       * when the relation arrived, taking the whole console with it: measured
       * CLS went 0.0022 to 0.0146 depending on which relation that run's
       * prices produced.
       *
       * A register is a glance. The sentence underneath already carries the
       * nuance in full — "Too close to call against UberX, the two ranges
       * overlap, so treat them as the same price" — so this says which of the
       * four it is and stops.
       */
      versusNextNote: !against
        ? null
        : against.relation === "cheaper"
          ? null
          : against.relation === "more_expensive"
            ? "Higher"
            : against.relation === "unclear"
              ? "Unclear"
              : "Similar",
    };
  }, [hero, ranked, rest, mapRoute]);

  const mapPickup = useMemo(() => {
    if (pickup) {
      return {
        lat: pickup.lat,
        lng: pickup.lng,
        label: pickup.label.split(",")[0] || "From",
      };
    }
    if (session) {
      return {
        lat: session.pickup.lat,
        lng: session.pickup.lng,
        label: session.pickup.name || session.pickup.formattedAddress.split(",")[0] || "From",
      };
    }
    return null;
  }, [pickup, session]);

  const mapDest = useMemo(() => {
    if (destination) {
      return {
        lat: destination.lat,
        lng: destination.lng,
        label: destination.label.split(",")[0] || "To",
      };
    }
    if (session) {
      return {
        lat: session.destination.lat,
        lng: session.destination.lng,
        label:
          session.destination.name || session.destination.formattedAddress.split(",")[0] || "To",
      };
    }
    return null;
  }, [destination, session]);

  const copyBest = async () => {
    if (!hero) return;
    try {
      await navigator.clipboard.writeText(
        `${providerLabel(hero)} ${hero.providerProductName}: ${formatQuotePrice(hero)}`,
      );
      setCopied("best");
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied("fail");
      window.setTimeout(() => setCopied(null), 2200);
    }
  };

  const copyAll = async () => {
    if (!ranked.length) return;
    const from = mapPickup?.label || session?.pickup.formattedAddress.split(",")[0] || "From";
    const to = mapDest?.label || session?.destination.formattedAddress.split(",")[0] || "To";
    const lines = [
      `RideLens · ${from} → ${to}`,
      insight?.text || null,
      ...ranked.map((q, i) => {
        const mark = i === 0 ? " ★" : "";
        return `${providerLabel(q)} ${q.providerProductName}: ${formatQuotePrice(q)}${mark}`;
      }),
      "Estimates — confirm in the provider app.",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied("all");
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied("fail");
      window.setTimeout(() => setCopied(null), 2200);
    }
  };

  const resultsAnnounce =
    hero && !loading
      ? `${ranked.length} options. Best is ${providerLabel(hero)} ${hero.providerProductName} at ${formatQuotePrice(hero)}.`
      : "";

  return (
    <section
      className={`results${loading ? " is-loading" : ""}`}
      ref={resultsTopRef}
      aria-labelledby="results-heading"
    >
      <h2 id="results-heading" className="sr-only">
        Ride options
      </h2>
      <p className="sr-only" aria-live="polite">
        {resultsAnnounce}
      </p>
      {mapPickup && mapDest ? (
        <div className="map-slot">
          <RouteMap
            pickup={mapPickup}
            destination={mapDest}
            route={mapRoute}
            loading={mapLoading && !mapRoute}
            /* Not while a price is still on its way. If the comparison ends
               with no price at all the hold lifts anyway, because the map is
               worth having even when pricing failed. */
            hold={loading && !hero}
          />
        </div>
      ) : null}

      {/*
        A slot that holds this banner's height while the quotes are still in
        flight. The notice only renders once every quote is known to be
        modeled, so it used to appear late and shove the toolbar, the filters
        and the whole comparison down — the only layout shift on the page,
        and the one a reader feels, because it lands just as they start
        reading. Reserving the space during loading means it fades in without
        moving anything.

        Reserved only while loading, deliberately: if a partner source is
        ever enabled the banner will not apply, and a permanent empty gap
        would be a worse bug than the one this fixes.
      */}
      <div className="notice-slot" data-reserved={loading ? "true" : "false"}>
        {everythingModeled ? (
          <p className="modeled-notice" data-testid="modeled-notice">
            <span aria-hidden>◆</span>
            <span>
              <strong>Modeled from published rates and live traffic</strong> — not a live provider
              quote. Every figure below is computed here; confirm in the app before you ride.
            </span>
          </p>
        ) : null}
      </div>

      <div className="results-toolbar sticky-bar">
        <div className="route-summary muted">
          {session || (pickup && destination) ? (
            <>
              <span>{mapPickup?.label || session?.pickup.formattedAddress.split(",")[0]}</span>
              <span aria-hidden>→</span>
              <span>{mapDest?.label || session?.destination.formattedAddress.split(",")[0]}</span>
            </>
          ) : (
            <span>Resolving route…</span>
          )}
        </div>
        <div className="toolbar-actions">
          {hero ? (
            <button type="button" className="ghost" onClick={copyBest}>
              {copied === "best" ? "Copied" : copied === "fail" ? "Copy failed" : "Copy best"}
            </button>
          ) : null}
          {ranked.length > 0 ? (
            <button type="button" className="ghost" onClick={copyAll}>
              {copied === "all" ? "Copied" : copied === "fail" ? "Copy failed" : "Copy all"}
            </button>
          ) : null}
          <button
            type="button"
            className="ghost"
            onClick={onRefresh}
            disabled={loading}
            aria-busy={loading}
          >
            {loading && hero ? "Updating…" : "Refresh prices"}
          </button>
        </div>
        {/*
          Inside the toolbar, and out of flow.
          ────────────────────────────────────
          As a sibling it was a grid item: 2px of bar plus 16px of grid gap,
          so every refresh pushed the whole comparison down 22px and pulled it
          back when the prices landed. Auto-refresh runs every 55 seconds, so
          it happened over and over — and because it happened only when a
          refresh landed inside the measurement window, it made `npm run perf`
          fail about one run in three for what looked like no reason.

          Absolutely positioned against the sticky bar it costs no height at
          all, and reads as what it is: that bar, loading.
        */}
        {loading && hero ? (
          <div className="refresh-progress" aria-hidden>
            <span />
          </div>
        ) : null}
      </div>

      {/*
        An alert is not a reading, so it sits above the console rather than
        inside it. Both of these are asking for an action.
      */}
      {agingQuotes ? (
        <div className="banner warn banner-with-action" role="status">
          <p>Estimates are aging: refresh for a sharper read.</p>
          <button
            type="button"
            className="ghost banner-retry"
            onClick={onRefresh}
            disabled={loading}
          >
            Refresh prices
          </button>
        </div>
      ) : null}

      {isPartial && !failedEmpty ? (
        <div className="banner warn banner-with-action" role="status">
          <p>
            Showing {succeeded.length} of {expected.length || succeeded.length + failures.length}{" "}
            sources
            {failures.length
              ? ` — retry ${failures.map((f) => humanizeSourceId(f.sourceId)).join(", ")}`
              : ""}
            .
          </p>
          <button
            type="button"
            className="ghost banner-retry"
            onClick={onRefresh}
            disabled={loading}
          >
            Refresh prices
          </button>
        </div>
      ) : null}

      {/*
        One console, not three bands.
        ─────────────────────────────
        The market strip, the takeaway and the trip stats were three separate
        cards stacked between the toolbar and the first price — three borders,
        three backgrounds, three of the five full-width bands a reader had to
        cross before reaching a number. They are one instrument cluster: what
        the market is doing, what that means, and the figures it produced. So
        they are drawn as one, divided by hairlines rather than by gaps.

        The loading placeholders live inside it, for the reason they were
        written in the first place: the strip, the takeaway and the stats all
        arrive with the quotes, so ~246px on desktop and ~410px on a phone used
        to appear at once and shove the whole comparison down. It was the
        largest thing moving on the page.

        They are built from the real classes rather than a reserved pixel
        height — these rewrap at narrow widths, and any number hard-coded here
        would be wrong on one side of that. Sharing the classes makes the
        placeholder the right size at every width by construction, and keeps it
        right when the layout changes.
      */}
      {hero || loading ? (
        <div className="console">
          {hero ? (
            /*
             * Not a live region, deliberately. This contains a countdown driven
             * by `now`, which re-renders every second, so role="status" made a
             * screen reader announce the whole strip — tone, multiplier, weather
             * and all — once per second for as long as the page was open. The
             * information here is ambient and repeated on the cards; the
             * meaningful summary is announced by the sr-only region below.
             */
            /*
              The tick, as a rule as well as a numeral.
              ─────────────────────────────────────────
              One custom property, written once a second by the render that
              already recomputes the numeral — so the bar under the strip and
              the number in it come from the same value and cannot disagree.
              No per-frame JavaScript, and nothing animated but a transform.

              When `tickLeft` is unknown the property is simply not set and
              the bar is not drawn. A product built on not overstating does
              not draw a gauge it cannot vouch for.
            */
            <div
              className="market-pulse"
              style={
                tickLeft != null
                  ? ({ "--tick-left": Math.min(1, tickLeft / 55) } as React.CSSProperties)
                  : undefined
              }
            >
              <span
                className={marketTone(hero.metadata?.demandCenter as number | undefined).className}
              >
                {marketTone(hero.metadata?.demandCenter as number | undefined).label}
              </span>
              {hero.metadata?.demandCenter != null ? (
                <span className="muted mono">×{Number(hero.metadata.demandCenter).toFixed(2)}</span>
              ) : null}
              {hero.metadata?.weather && !String(hero.metadata.weather).startsWith("dry") ? (
                <span className="market-chip is-rain">Weather active</span>
              ) : (
                <span className="muted">Clear conditions</span>
              )}
              {/*
                Whether the ordering this page is recommending survives its
                own assumptions. It lands a moment after the prices do; the
                slot holds its width from the first paint so it does not shove
                the countdown when it arrives.
              */}
              <span className="robust-slot">
                <RobustnessChip
                  sessionId={session?.id ?? null}
                  quoteIds={ranked.map((q) => q.id)}
                />
              </span>
              {tickLeft != null && tickLeft > 0 ? (
                <span className="market-tick muted">
                  Next <strong>{tickLeft}s</strong>
                </span>
              ) : tickLeft === 0 ? (
                <button
                  type="button"
                  className="market-tick market-tick-btn ghost"
                  onClick={onRefresh}
                  disabled={loading}
                >
                  Market tick due · refresh now
                </button>
              ) : null}
            </div>
          ) : (
            <div className="market-pulse" aria-hidden>
              <span className="sk-line w30" />
              <span className="sk-line w20" />
            </div>
          )}

          {takeaway || insight ? (
            <div className="insight-banner" role="status">
              <p className="insight-kicker">Takeaway</p>
              <p className="insight-text">{takeaway ?? insight!.text}</p>
            </div>
          ) : loading ? (
            <div className="insight-banner" aria-hidden>
              <p className="insight-kicker">Takeaway</p>
              <p className="insight-text">
                <span className="sk-line w60" />
              </p>
            </div>
          ) : null}

          {/*
            Every cell, every time, once there is a row at all.
            ───────────────────────────────────────────────────
            Miles and drive time come from the route; wait, best estimate and
            the saving come from the quotes, which land later. Rendering only
            the cells that had data meant the row appeared with two and grew to
            five, moving the comparison under it. A cell with nothing in it yet
            holds its own place.
          */}
          <div className="trip-stats">
            <div>
              <span className="stat-value">
                {tripStats?.miles != null ? (
                  tripStats.miles.toFixed(1)
                ) : (
                  <span className="sk-line w60" />
                )}
              </span>
              <span className="stat-label">Miles</span>
            </div>
            <div>
              <span className="stat-value">
                {tripStats?.minWait != null ? (
                  formatTripMins(tripStats.minWait).replace("~", "")
                ) : (
                  <span className="sk-line w60" />
                )}
              </span>
              <span className="stat-label">Min wait</span>
            </div>
            <div className="trip-stat-desktop">
              <span className="stat-value">
                {tripStats?.minDrive != null ? (
                  formatTripMins(tripStats.minDrive).replace("~", "")
                ) : (
                  <span className="sk-line w60" />
                )}
              </span>
              <span className="stat-label">Min drive</span>
            </div>
            <div className="trip-stat-wide">
              <span className="stat-value">
                {tripStats?.bestFrom != null ? (
                  formatMoneyMinor(tripStats.bestFrom)
                ) : (
                  <span className="sk-line w60" />
                )}
              </span>
              {/* "From", because it is the low end of a band and not a figure
                  anybody was quoted — unless the band is a point, in which
                  case it is the fare. The card below prints the whole band. */}
              <span className="stat-label">{tripStats?.bestIsPoint ? "Best" : "Best, from"}</span>
            </div>
            <div className="trip-stat-desktop">
              <span className={`stat-value${tripStats?.versusNextNote ? " is-relation" : ""}`}>
                {tripStats?.versusNext != null ? (
                  formatMoneyMinor(tripStats.versusNext)
                ) : tripStats?.versusNextNote ? (
                  tripStats.versusNextNote
                ) : hero ? (
                  /*
                   * There is a hero and no runner-up — one option survived the
                   * filter — so there is nothing to compare against and there
                   * never will be. This cell used to fall through to the
                   * loading shimmer, which runs `infinite`: a placeholder
                   * pulsing under "VS NEXT" forever, promising a figure that
                   * is not coming. An em dash is what an instrument prints
                   * for no reading.
                   */
                  <span aria-label="nothing to compare against">—</span>
                ) : (
                  <span className="sk-line w60" />
                )}
              </span>
              <span className="stat-label">
                {tripStats?.versusNext != null ? "Saves vs next" : "Vs next"}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/*
        Why the top row is on top, when that is not obvious.
        ────────────────────────────────────────────────────
        A sorted list asserts an ordering and explains nothing, which is fine
        while the leader is plainly cheapest and misleading the moment it is
        not. Silent whenever the ordering speaks for itself — a note on every
        card is a note nobody reads.
      */}
      {winnerNote ? (
        <p className="winner-note" data-reason={winnerNote.reason}>
          {winnerNote.sentence}
        </p>
      ) : null}

      {/* Actionable before choosing a provider, so it goes above the board —
          it is worthless once somebody has tapped through to an app. */}
      {hero ? <WalkSuggestionCard sessionId={session?.id ?? null} /> : null}

      {/*
        Two choices, drawn as two choices.
        ──────────────────────────────────
        Eight loose pills in a row do not say that picking Soonest and picking
        XL are unrelated decisions, or that each is one-of-a-set. Enclosing
        each set says both without a word, and it is the same object as the
        deck's tab strip — which is the same kind of decision again.

        Still buttons with aria-pressed rather than a radiogroup: they are not
        a form control, they take effect immediately, and a radio group would
        promise arrow-key semantics that the rest of this toolbar does not have.
      */}
      <div className="filters" role="toolbar" aria-label="Ranking and category">
        <div className="segmented" role="group" aria-label="Rank by">
          {(
            [
              ["cheapest", "Price"],
              ["fastest", "Soonest"],
              ["best_value", "Value"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={mode === id ? "chip active" : "chip"}
              aria-pressed={mode === id}
              onClick={() => withTransition(() => onModeChange(id))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Vehicle class">
          {(
            [
              ["standard", "Standard"],
              ["TAXI", "Taxi"],
              ["XL", "XL"],
              ["PREMIUM", "Premium"],
              ["ALL", "All"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={filter === id ? "chip active" : "chip"}
              aria-pressed={filter === id}
              onClick={() => withTransition(() => onFilterChange(id))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && !hero ? (
        <div className="skeletons" aria-busy="true" aria-label="Loading quotes">
          {(["uber", "lyft", "empower", "curb"] as const).map((p) => (
            /*
              The two things somebody is actually waiting for.
              ────────────────────────────────────────────────
              This stood in for a ~340px card with a 26px price on the right
              and a 48px button at the foot, and it was a logo and three
              lines — about 96px, with no placeholder for the price or the
              CTA at all. The console's skeletons were agonised over, down to
              a comment about 14px of shift; the card list, where ~900px of
              growth lands, got none of it.
            */
            <div key={p} className="skeleton-card" aria-hidden>
              <div className="sk-head">
                <ProviderLogo provider={p} size={40} />
                <div className="sk-lines">
                  <div className="sk-line w40" />
                  <div className="sk-line w60" />
                </div>
                <div className="sk-price" />
              </div>
              <div className="sk-row">
                <div className="sk-line" />
                <div className="sk-line" />
                <div className="sk-line" />
                <div className="sk-line" />
              </div>
              <div className="sk-chips">
                <div className="sk-line" />
                <div className="sk-line" />
                <div className="sk-line" />
                <div className="sk-line" />
              </div>
              <div className="sk-line w30" />
              <div className="sk-cta" />
            </div>
          ))}
        </div>
      ) : null}

      {pendingSources.length > 0 && hero ? (
        <div className="pending-strip" role="status">
          <span className="muted">Still lining up</span>
          <div className="pending-logos">
            {pendingSources.map((s) => {
              const lower = s.toLowerCase();
              const provider = (["uber", "lyft", "empower", "curb"] as const).find((p) =>
                lower.includes(p),
              );
              const label = provider
                ? provider
                : lower.includes("rate")
                  ? "Rate cards"
                  : s.replace(/_/g, " ");
              return (
                <span key={s} className="pending-chip">
                  {provider ? <ProviderLogo provider={provider} size={24} /> : null}
                  <span>{label}</span>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {hero ? (
        <div className="hero-quote">
          <div className="section-label-row">
            <p className="section-label">{heroTitle(mode)}</p>
            {onReverseTrip && pickup && destination ? (
              <button type="button" className="chip reverse-chip" onClick={onReverseTrip}>
                Going back? Swap trip
              </button>
            ) : null}
          </div>
          <QuoteCard
            sessionId={session?.id}
            quote={hero}
            hero
            index={0}
            now={now}
            animate={animateEntrance}
          />
          {/*
            One strip, tucked under the card rather than two things floating
            below it. The watch control on its own read as an orphaned pill
            sitting between the hero and "All options" — it belongs to the
            price above it, and now looks like it.
          */}
          {/*
            Gated on the session and nothing else.
            ───────────────────────────────────────
            This used to require a watch context or a trip log — which is true
            in practice the moment anything is priced, and was still the wrong
            condition: whether the assistant exists is a question about
            whether it is configured, not about whether the rider happens to
            have a history. Each piece inside decides for itself, and each one
            already knows how to render nothing.
          */}
          {session ? (
            <div className="hero-extras">
              <RouteStanding session={session} records={tripRecords} modelVersion={MODEL_VERSION} />
              {watchContext ? (
                <PriceWatchControl
                  from={watchContext.from}
                  to={watchContext.to}
                  cheapestLowMinor={watchContext.low}
                  watch={watchContext.watch}
                  result={watchContext.result}
                  onSet={priceWatches.set}
                  onRemove={priceWatches.remove}
                />
              ) : null}
              {/* Asked about the price directly above it, rather than
                  floating between the hero and the list. */}
              <Assistant
                sessionId={session.id}
                trips={tripRecords}
                onAction={runAssistantAction}
                suggestions={assistantSuggestions}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {rest.length > 0 ? (
        <div className="all-options">
          <p className="section-label">All options</p>
          <div className="quote-list">
            {rest.map((q, i) => (
              <QuoteCard
                sessionId={session?.id}
                key={`${q.provider}:${q.providerProductId || q.providerProductName}`}
                quote={q}
                index={i + 1}
                now={now}
                animate={animateEntrance}
                deltaMinor={hero ? q.rankingPriceMinor - hero.rankingPriceMinor : undefined}
                waitDeltaSec={
                  hero?.pickupEtaSeconds != null && q.pickupEtaSeconds != null
                    ? q.pickupEtaSeconds - hero.pickupEtaSeconds
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      ) : null}

      {failures.length > 0 ? (
        <div className="failures">
          <p className="section-label">Source issues</p>
          <ul>
            {failures.map((f) => (
              <li key={`${f.sourceId}-${f.code}`}>
                <strong>{humanizeSourceId(f.sourceId)}</strong>: {f.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {session?.discrepancies?.length ? (
        <div className="failures">
          <p className="section-label">Price discrepancies</p>
          <ul>
            {session.discrepancies.map((d, i) => (
              <li key={`${d.message}-${i}`}>{d.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {failedEmpty ? (
        <div className="banner danger empty-filter" role="alert">
          <p>
            {session?.status === "FAILED"
              ? "We couldn’t pull estimates for this route. Check your connection and try again."
              : "No estimates came back for this route. Refresh or try a nearby pin."}
          </p>
          <div className="empty-filter-actions">
            <button type="button" className="ghost" onClick={onRefresh}>
              Retry comparison
            </button>
          </div>
        </div>
      ) : null}

      {filterEmpty ? (
        <div className="banner warn empty-filter" role="status">
          <p>No quotes matched this filter. Try All, or refresh prices.</p>
          <div className="empty-filter-actions">
            <button type="button" className="chip active" onClick={() => onFilterChange("ALL")}>
              Show all
            </button>
            <button type="button" className="ghost" onClick={onRefresh}>
              Refresh prices
            </button>
          </div>
        </div>
      ) : null}

      {/*
        Everything that is not the comparison itself, behind one strip of
        tabs. These were six stacked sections running to 3371px, and the four
        best of them started below 2200 — which is to say nobody read them.
        See insights-deck.tsx for why a deck rather than a column.
      */}
      {hero ? (
        <InsightsDeck
          quotes={ranked}
          session={session ?? null}
          /* One pass: filtering first would shift the index away from the
             quote it came from, and pair a provider with someone else's
             product. */
          showProducts={
            new Set(
              ranked.flatMap((q) => {
                const product = q.metadata?.fareProduct;
                return typeof product === "string" ? [`${q.provider}:${product}`] : [];
              }),
            )
          }
        />
      ) : null}

      <p className="fineprint muted">
        Estimates blend live road distance, published rate cards, corridor anchors, and a simulated
        marketplace (time, zone heat, weather). Provider apps may show promos or account pricing —
        always confirm before booking.
      </p>
    </section>
  );
}
