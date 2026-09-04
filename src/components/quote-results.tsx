"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  NormalizedQuote,
  QuoteSession,
  RankingMode,
  RideCategory,
} from "@/lib/domain/types";
import {
  formatQuotePrice,
  formatMoneyMinor,
  quoteTypeLabel,
} from "@/lib/domain/money";
import { freshnessLabel, freshnessStatus } from "@/lib/domain/freshness";
import { categoryLabel } from "@/lib/domain/taxonomy";
import { rankQuotes } from "@/lib/domain/ranking";
import { computeSavings, defaultBaseline } from "@/lib/domain/savings";
import { isAllowedBookingUrl } from "@/lib/booking/allowed-hosts";
import { ProviderLogo } from "@/components/provider-logo";
import { RouteMap, type MapRoute } from "@/components/route-map";
import type { PlaceValue } from "@/components/place-field";

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

function freshnessLine(q: NormalizedQuote, now = new Date()): string {
  const status = freshnessStatus(q.freshness);
  const age = freshnessLabel(q.freshness, q.receivedAt, now);
  if (age === "Just now") return status;
  return `${status} · ${age}`;
}

function statusDotClass(q: NormalizedQuote): string {
  const status = freshnessStatus(q.freshness);
  if (status === "Fresh") return "status-dot is-fresh";
  if (status === "Recent") return "status-dot is-recent";
  if (status === "Expired") return "status-dot is-expired";
  return "status-dot is-aging";
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
    return `${lo}–${hi} min`;
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
  const base = raw.split("+")[0] || raw;
  const map: Record<string, string> = {
    late_night: "Late night",
    morning_peak: "Morning peak",
    morning: "Morning",
    evening_peak: "Evening peak",
    evening: "Evening",
    midday: "Midday",
    overnight: "Overnight",
    weekend: "Weekend",
    flat_fare: "Flat fare",
  };
  return map[base] || base.replace(/_/g, " ");
}

function confidenceFromBand(band: number | undefined): {
  label: string;
  pct: number;
} | null {
  if (band == null) return null;
  // tighter band → higher confidence (2% → ~90, 3.5% → ~70)
  const pct = Math.max(55, Math.min(94, Math.round(100 - band * 900)));
  const label =
    pct >= 85 ? "High confidence" : pct >= 72 ? "Solid estimate" : "Wider band";
  return { label, pct };
}

function FeeBreakdown({ quote }: { quote: NormalizedQuote }) {
  const fees = quote.metadata?.feeBreakdown as
    | Record<string, number>
    | undefined;
  const center = quote.metadata?.centerFare as number | undefined;
  const band = quote.metadata?.band as number | undefined;
  const city = quote.metadata?.city as string | undefined;
  const demand = humanizeDemand(quote.metadata?.demand as string | undefined);
  const anchor = quote.metadata?.anchorId as string | undefined;
  const methodology = quote.metadata?.methodology as string | undefined;
  const confidence = confidenceFromBand(band);

  if (!fees && center == null) return null;

  return (
    <details className="fee-breakdown">
      <summary>How this was estimated</summary>
      <div className="fee-body">
        {center != null ? (
          <p>
            Center <strong>{formatMoneyMinor(Math.round(center * 100))}</strong>
            {band != null ? (
              <span className="muted"> (±{(band * 100).toFixed(1)}%)</span>
            ) : null}
          </p>
        ) : null}
        {confidence ? (
          <div className="confidence" aria-label={confidence.label}>
            <div className="confidence-meta">
              <span>{confidence.label}</span>
              <span className="muted">{confidence.pct}%</span>
            </div>
            <div className="confidence-track">
              <span
                className="confidence-fill"
                style={{ width: `${confidence.pct}%` }}
              />
            </div>
          </div>
        ) : null}
        {city ? <p className="muted">Market: {city}</p> : null}
        {demand ? <p className="muted">Demand: {demand}</p> : null}
        {anchor ? (
          <p className="muted">Corridor: {anchor.replace(/_/g, " ")}</p>
        ) : null}
        {fees && Object.keys(fees).length > 0 ? (
          <ul>
            {Object.entries(fees).map(([k, v]) => {
              const isFactor = /factor/i.test(k);
              return (
                <li key={k}>
                  <span>{k.replace(/_/g, " ")}</span>
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
  heroMode,
  deltaMinor,
  waitDeltaSec,
  destinationLabel,
  index = 0,
}: {
  quote: NormalizedQuote;
  hero?: boolean;
  heroMode?: RankingMode;
  deltaMinor?: number;
  waitDeltaSec?: number;
  destinationLabel?: string;
  index?: number;
}) {
  const handoff = quote.bookingHandoff;
  const now = new Date();
  const dollarsPerMile =
    quote.distanceMeters && quote.distanceMeters > 0
      ? quote.rankingPriceMinor / 100 / (quote.distanceMeters / 1609.344)
      : null;

  const pickupSec = quote.pickupEtaSeconds;
  const waitLow = quote.metadata?.waitLowSeconds as number | undefined;
  const waitHigh = quote.metadata?.waitHighSeconds as number | undefined;
  const driveSec = quote.tripDurationSeconds;
  const totalSec =
    pickupSec != null && driveSec != null ? pickupSec + driveSec : null;
  const arriveLabel =
    totalSec != null ? formatClock(now, totalSec) : "—";

  const bookingUrl = handoff?.url;
  const bookingOk = bookingUrl ? isAllowedBookingUrl(bookingUrl) : false;
  const pickupAddr = String(quote.metadata?.pickupAddress || "");
  const destAddr = String(
    quote.metadata?.destinationAddress || destinationLabel || "",
  );

  const bookHref = handoff?.url
    ? handoff.kind === "interstitial" || !bookingOk
      ? `/book?provider=${quote.provider}&price=${encodeURIComponent(formatQuotePrice(quote))}&pickup=${encodeURIComponent(pickupAddr)}&destination=${encodeURIComponent(destAddr)}&url=${encodeURIComponent(handoff.url)}`
      : handoff.url
    : null;

  const bookLabel =
    handoff?.label ||
    (handoff?.kind === "interstitial" || !bookingOk
      ? `Open ${providerLabel(quote)}`
      : `Book with ${providerLabel(quote)}`);

  return (
    <article
      className={`quote-card${hero ? " hero" : ""} reveal-card`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <header className="quote-card-header">
        <ProviderLogo provider={quote.provider} size={40} />
        <div className="quote-identity">
          <p className="provider">{providerLabel(quote)}</p>
          <p className="product">{quote.providerProductName}</p>
        </div>
        <div className="price-block">
          <p className="price" aria-label={`Price ${formatQuotePrice(quote)}`}>
            {formatQuotePrice(quote)}
          </p>
          {dollarsPerMile != null ? (
            <p className="per-mile muted">${dollarsPerMile.toFixed(2)}/mi</p>
          ) : null}
        </div>
      </header>

      <div className="wait-row" aria-label="Trip timing">
        <div className="wait-cell">
          <span className="wait-label">Pickup</span>
          <span className="wait-value">
            {formatWaitRange(pickupSec, waitLow, waitHigh)}
          </span>
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
        <span className="meta-chip">
          <span className={statusDotClass(quote)} aria-hidden />
          {freshnessLine(quote, now)}
        </span>
      </div>

      {hero ? (
        <p className="hero-label">{heroTitle(heroMode || "cheapest")}</p>
      ) : null}
      {!hero && deltaMinor != null && deltaMinor > 0 ? (
        <p className="delta muted">
          +{formatMoneyMinor(deltaMinor)} vs best
          {waitDeltaSec != null && waitDeltaSec > 30 ? (
            <span>
              {" "}
              · +{Math.round(waitDeltaSec / 60)} min wait
            </span>
          ) : null}
        </p>
      ) : null}

      <FeeBreakdown quote={quote} />

      {bookHref ? (
        <a
          className="book book-with-logo"
          href={bookHref}
          {...(handoff?.kind !== "interstitial" && bookingOk
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
        >
          <ProviderLogo provider={quote.provider} size={24} />
          {bookLabel}
        </a>
      ) : (
        <span className="book disabled">Open provider in a moment</span>
      )}
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
  mapRoute: MapRoute | null;
  mapLoading: boolean;
  pickup: PlaceValue | null;
  destination: PlaceValue | null;
}) {
  const [copied, setCopied] = useState<"best" | "all" | null>(null);
  const resultsTopRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!session || loading) return;
    const el = resultsTopRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }, [session?.id]);

  const ranked = useMemo(() => {
    const raw = session?.quotes ?? [];
    const categoryFilter =
      filter === "standard" || filter === "ALL"
        ? filter
        : ([filter] as RideCategory[]);
    return rankQuotes(raw, mode, categoryFilter);
  }, [session?.quotes, mode, filter]);

  const hero = ranked[0];
  const rest = ranked.slice(1);
  const failures = session?.coverage.sourcesFailed ?? [];
  const expected = session?.coverage.sourcesExpected ?? [];
  const pendingSources = expected.filter(
    (s) =>
      !session?.coverage.sourcesSucceeded.includes(s) &&
      !failures.some((f) => f.sourceId === s),
  );

  const insight = useMemo(() => {
    if (!hero) return null;
    const baseline = defaultBaseline(hero, ranked);
    return computeSavings(hero, baseline);
  }, [hero, ranked]);

  const tripStats = useMemo(() => {
    const q = hero || ranked[0];
    if (!q && !mapRoute) return null;
    const waits = ranked
      .map((x) => x.pickupEtaSeconds)
      .filter((n): n is number => n != null);
    const drives = ranked
      .map((x) => x.tripDurationSeconds)
      .filter((n): n is number => n != null);
    const versusNext =
      hero && rest[0]
        ? rest[0].rankingPriceMinor - hero.rankingPriceMinor
        : null;
    return {
      miles:
        mapRoute?.miles ??
        (q?.distanceMeters ? q.distanceMeters / 1609.344 : null),
      minWait: waits.length ? Math.min(...waits) : null,
      minDrive:
        mapRoute?.minutes != null
          ? mapRoute.minutes * 60
          : drives.length
            ? Math.min(...drives)
            : null,
      bestMid: hero?.rankingPriceMinor ?? null,
      versusNext:
        versusNext != null && versusNext > 0 ? versusNext : null,
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
        label:
          session.pickup.name ||
          session.pickup.formattedAddress.split(",")[0] ||
          "From",
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
          session.destination.name ||
          session.destination.formattedAddress.split(",")[0] ||
          "To",
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
      /* ignore */
    }
  };

  const copyAll = async () => {
    if (!ranked.length) return;
    const from =
      mapPickup?.label ||
      session?.pickup.formattedAddress.split(",")[0] ||
      "From";
    const to =
      mapDest?.label ||
      session?.destination.formattedAddress.split(",")[0] ||
      "To";
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
      /* ignore */
    }
  };

  return (
    <section
      className={`results${loading ? " is-loading" : ""}`}
      aria-live="polite"
      ref={resultsTopRef}
    >
      {mapPickup && mapDest ? (
        <div className="map-slot">
          <RouteMap
            pickup={mapPickup}
            destination={mapDest}
            route={mapRoute}
            loading={mapLoading || loading}
          />
        </div>
      ) : null}

      <div className="results-toolbar sticky-bar">
        <div className="route-summary muted">
          {session || (pickup && destination) ? (
            <>
              <span>
                {mapPickup?.label ||
                  session?.pickup.formattedAddress.split(",")[0]}
              </span>
              <span aria-hidden>→</span>
              <span>
                {mapDest?.label ||
                  session?.destination.formattedAddress.split(",")[0]}
              </span>
            </>
          ) : (
            <span>Resolving route…</span>
          )}
        </div>
        <div className="toolbar-actions">
          {hero ? (
            <button type="button" className="ghost" onClick={copyBest}>
              {copied === "best" ? "Copied" : "Copy best"}
            </button>
          ) : null}
          {ranked.length > 0 ? (
            <button type="button" className="ghost" onClick={copyAll}>
              {copied === "all" ? "Copied" : "Copy all"}
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

      {insight ? (
        <div className="insight-banner" role="status">
          <p className="insight-kicker">Takeaway</p>
          <p className="insight-text">{insight.text}</p>
        </div>
      ) : null}

      {tripStats &&
      (tripStats.miles != null ||
        tripStats.minWait != null ||
        tripStats.bestMid != null) ? (
        <div className="trip-stats">
          {tripStats.miles != null ? (
            <div>
              <span className="stat-value">
                {tripStats.miles.toFixed(1)}
              </span>
              <span className="stat-label">Miles</span>
            </div>
          ) : null}
          {tripStats.minWait != null ? (
            <div>
              <span className="stat-value">
                {formatTripMins(tripStats.minWait).replace("~", "")}
              </span>
              <span className="stat-label">Min wait</span>
            </div>
          ) : null}
          {tripStats.minDrive != null ? (
            <div className="trip-stat-desktop">
              <span className="stat-value">
                {formatTripMins(tripStats.minDrive).replace("~", "")}
              </span>
              <span className="stat-label">Min drive</span>
            </div>
          ) : null}
          {tripStats.bestMid != null ? (
            <div>
              <span className="stat-value">
                {formatMoneyMinor(tripStats.bestMid)}
              </span>
              <span className="stat-label">Best estimate</span>
            </div>
          ) : null}
          {tripStats.versusNext != null ? (
            <div className="trip-stat-desktop">
              <span className="stat-value">
                {formatMoneyMinor(tripStats.versusNext)}
              </span>
              <span className="stat-label">Saves vs next</span>
            </div>
          ) : null}
        </div>
      ) : null}

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
              const provider = (
                ["uber", "lyft", "empower", "curb"] as const
              ).find((p) => lower.includes(p));
              const label = provider
                ? provider
                : lower.includes("rate")
                  ? "Rate cards"
                  : s.replace(/_/g, " ");
              return (
                <span key={s} className="pending-chip">
                  {provider ? (
                    <ProviderLogo provider={provider} size={24} />
                  ) : null}
                  <span>{label}</span>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {hero ? (
        <div className="hero-quote">
          <p className="section-label">{heroTitle(mode)}</p>
          <QuoteCard
            quote={hero}
            hero
            heroMode={mode}
            destinationLabel={mapDest?.label}
            index={0}
          />
        </div>
      ) : null}

      {rest.length > 0 ? (
        <div className="all-options">
          <p className="section-label">All options</p>
          <div className="quote-list">
            {rest.map((q, i) => (
              <QuoteCard
                key={q.id}
                quote={q}
                destinationLabel={mapDest?.label}
                index={i + 1}
                deltaMinor={
                  hero
                    ? q.rankingPriceMinor - hero.rankingPriceMinor
                    : undefined
                }
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
                <strong>{f.sourceId}</strong>: {f.message}
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
              <li key={i}>{d.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {session && !loading && ranked.length === 0 ? (
        <div className="banner warn empty-filter" role="status">
          <p>No quotes matched this filter. Try All, or refresh prices.</p>
          <div className="empty-filter-actions">
            <button
              type="button"
              className="chip active"
              onClick={() => onFilterChange("ALL")}
            >
              Show all
            </button>
            <button type="button" className="ghost" onClick={onRefresh}>
              Refresh prices
            </button>
          </div>
        </div>
      ) : null}

      <p className="fineprint muted">
        Estimates blend live road distance, published rate cards, and known
        corridor averages. Provider apps may show promos or account pricing —
        always confirm before booking.
      </p>
    </section>
  );
}
