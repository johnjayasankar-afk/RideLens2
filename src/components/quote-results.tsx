"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { rankQuotes } from "@/lib/domain/ranking";
import { computeSavings, defaultBaseline } from "@/lib/domain/savings";
import { ProviderLogo } from "@/components/provider-logo";
import { ProvenanceChip } from "@/components/provenance-chip";
import { provenanceOf } from "@/lib/domain/provenance";
import { explainWinner } from "@/lib/domain/why-this-one";
import { AlternativesRow } from "./alternatives-row";
import { PriceAxis } from "./price-axis";
import { WalkSuggestionCard } from "./walk-suggestion";
import { PartyPanel } from "./party-panel";
import { DepartureStrip } from "./departure-strip";
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
  pickupLabel,
  destinationLabel,
  index = 0,
  now,
  sessionId,
  animate = true,
}: {
  quote: NormalizedQuote;
  hero?: boolean;
  deltaMinor?: number;
  waitDeltaSec?: number;
  pickupLabel?: string;
  destinationLabel?: string;
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
      style={animate ? { animationDelay: `${Math.min(index, 8) * 45}ms` } : undefined}
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
        <span className="meta-chip">
          <span className={statusDotClass(quote, now)} aria-hidden />
          {freshnessLine(quote, now)}
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

      <a className="book book-with-logo" href={bookHref}>
        <ProviderLogo provider={quote.provider} size={24} />
        {bookLabel}
      </a>
    </article>
  );
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
    return parts[0] + (parts[1] ? ` ${parts[1]}` : "");
  }, [hero, insight, rest]);

  const tripStats = useMemo(() => {
    const q = hero || ranked[0];
    if (!q && !mapRoute) return null;
    const waits = ranked.map((x) => x.pickupEtaSeconds).filter((n): n is number => n != null);
    const drives = ranked.map((x) => x.tripDurationSeconds).filter((n): n is number => n != null);
    const versusNext = hero && rest[0] ? rest[0].rankingPriceMinor - hero.rankingPriceMinor : null;
    return {
      miles: mapRoute?.miles ?? (q?.distanceMeters ? q.distanceMeters / 1609.344 : null),
      minWait: waits.length ? Math.min(...waits) : null,
      minDrive:
        mapRoute?.minutes != null
          ? mapRoute.minutes * 60
          : drives.length
            ? Math.min(...drives)
            : null,
      bestMid: hero?.rankingPriceMinor ?? null,
      versusNext: versusNext != null && versusNext > 0 ? versusNext : null,
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

  const tripPickupLabel = useMemo(() => {
    return (
      pickup?.formattedAddress ||
      pickup?.label ||
      session?.pickup.formattedAddress ||
      mapPickup?.label ||
      ""
    );
  }, [pickup, session, mapPickup]);

  const tripDestLabel = useMemo(() => {
    return (
      destination?.formattedAddress ||
      destination?.label ||
      session?.destination.formattedAddress ||
      mapDest?.label ||
      ""
    );
  }, [destination, session, mapDest]);

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
      </div>
      {loading && hero ? (
        <div className="refresh-progress" aria-hidden>
          <span />
        </div>
      ) : null}

      {hero ? (
        /*
         * Not a live region, deliberately. This contains a countdown driven
         * by `now`, which re-renders every second, so role="status" made a
         * screen reader announce the whole strip — tone, multiplier, weather
         * and all — once per second for as long as the page was open. The
         * information here is ambient and repeated on the cards; the
         * meaningful summary is announced by the sr-only region below.
         */
        <div className="market-pulse">
          <span className={marketTone(hero.metadata?.demandCenter as number | undefined).className}>
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
          {tickLeft != null && tickLeft > 0 ? (
            <span className="market-tick muted">
              Prices reshape in <strong>{tickLeft}s</strong>
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
      ) : null}

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

      {takeaway ? (
        <div className="insight-banner" role="status">
          <p className="insight-kicker">Takeaway</p>
          <p className="insight-text">{takeaway}</p>
        </div>
      ) : insight ? (
        <div className="insight-banner" role="status">
          <p className="insight-kicker">Takeaway</p>
          <p className="insight-text">{insight.text}</p>
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

      {/*
        Every cell, every time, once there is a row at all.
        ───────────────────────────────────────────────────
        Miles and drive time come from the route; wait, best estimate and
        the saving come from the quotes, which land later. Rendering only
        the cells that had data meant the row appeared with two and grew to
        five, moving the comparison under it. A cell with nothing in it yet
        holds its own place.
      */}
      {(tripStats &&
        (tripStats.miles != null || tripStats.minWait != null || tripStats.bestMid != null)) ||
      loading ? (
        <div className="trip-stats">
          {tripStats?.miles != null || loading ? (
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
          ) : null}
          {tripStats?.minWait != null || loading ? (
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
          ) : null}
          {tripStats?.minDrive != null || loading ? (
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
          ) : null}
          {tripStats?.bestMid != null || loading ? (
            <div>
              <span className="stat-value">
                {tripStats?.bestMid != null ? (
                  formatMoneyMinor(tripStats.bestMid)
                ) : (
                  <span className="sk-line w60" />
                )}
              </span>
              <span className="stat-label">Best estimate</span>
            </div>
          ) : null}
          {tripStats?.versusNext != null || loading ? (
            <div className="trip-stat-desktop">
              <span className="stat-value">
                {tripStats?.versusNext != null ? (
                  formatMoneyMinor(tripStats.versusNext)
                ) : (
                  <span className="sk-line w60" />
                )}
              </span>
              <span className="stat-label">Saves vs next</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/*
        The summary that is not there yet.
        ──────────────────────────────────
        The market strip, the takeaway and the trip stats all render only
        once quotes exist, so ~246px on desktop and ~410px on a phone
        appeared at once and shoved the filters and the whole comparison
        down. It was the largest thing moving on the page.

        Built from the same classes as the real blocks rather than a
        reserved pixel height: these rewrap at narrow widths, and any number
        hard-coded here would be wrong on one side of that. Sharing the
        classes makes the placeholder the right size at every width by
        construction, and keeps it right when the layout changes.

        The trip stats are not here. That row appears during loading anyway,
        because miles and drive time come from the route rather than the
        quotes, so it fills its own empty cells instead — a duplicate
        skeleton sat underneath the real row and showed both at once.
      */}
      {loading && !hero ? (
        <div className="summary-skeleton" aria-hidden>
          <div className="market-pulse">
            <span className="sk-line w30" />
            <span className="sk-line w20" />
          </div>
          <div className="insight-banner">
            <p className="insight-kicker">Takeaway</p>
            <p className="insight-text">
              <span className="sk-line w60" />
            </p>
          </div>
        </div>
      ) : null}

      {/* Actionable before choosing a provider, so it goes above the board —
          it is worthless once somebody has tapped through to an app. */}
      {hero ? <WalkSuggestionCard sessionId={session?.id ?? null} /> : null}

      <div className="filters" role="toolbar" aria-label="Ranking and category">
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
            onClick={() => onModeChange(id)}
          >
            {label}
          </button>
        ))}
        <span className="sep" aria-hidden />
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
            onClick={() => onFilterChange(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && !hero ? (
        <div className="skeletons" aria-busy="true" aria-label="Loading quotes">
          {(["uber", "lyft", "empower", "curb"] as const).map((p) => (
            <div key={p} className="skeleton-card" aria-hidden>
              <div className="sk-head">
                <ProviderLogo provider={p} size={40} />
                <div className="sk-lines">
                  <div className="sk-line w40" />
                  <div className="sk-line w60" />
                </div>
              </div>
              <div className="sk-line w30" />
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
            pickupLabel={tripPickupLabel}
            destinationLabel={tripDestLabel}
            index={0}
            now={now}
            animate={animateEntrance}
          />
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
                pickupLabel={tripPickupLabel}
                destinationLabel={tripDestLabel}
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
        Below the comparison, deliberately. It answers a different question —
        whether waiting helps — and the answer is usually "no", which is not
        a thing to lead with. It also fetches itself only when scrolled to;
        projecting every provider across the hour is a few hundred runs of
        the fare engine.
      */}
      {/* The visual form of comparePrices: overlap you can see. */}
      {hero ? <PriceAxis quotes={ranked} /> : null}

      {/* Before the forecast: whether to take a car at all comes before when. */}
      {hero ? <AlternativesRow sessionId={session?.id ?? null} /> : null}

      {hero ? <PartyPanel quotes={ranked} /> : null}

      {hero ? (
        <DepartureStrip
          sessionId={session?.id ?? null}
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
