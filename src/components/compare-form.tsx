"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlaceField, type PlaceFieldHandle, type PlaceValue } from "@/components/place-field";
import { QuoteResults } from "@/components/quote-results";
import { ProviderLogo } from "@/components/provider-logo";
import type { ProviderId, QuoteSession } from "@/lib/domain/types";
import type { MapRoute } from "@/components/route-map";

type RecentRoute = {
  id: string;
  pickup: PlaceValue;
  destination: PlaceValue;
  savedAt: number;
};

type RankingMode = "cheapest" | "fastest" | "best_value";
type FilterId = "standard" | "ALL" | "XL" | "PREMIUM" | "TAXI";

const RECENT_KEY = "ridelens.recentRoutes";
const NEAR_IDENTICAL_M = 150;

const PROVIDERS: ProviderId[] = ["uber", "lyft", "empower", "curb"];

const QUICK_PICKS: { label: string; place: PlaceValue }[] = [
  {
    label: "JFK",
    place: {
      lat: 40.6413,
      lng: -73.7781,
      formattedAddress: "John F. Kennedy International Airport, Queens, NY",
      label: "JFK Airport, Queens, NY",
    },
  },
  {
    label: "LGA",
    place: {
      lat: 40.7769,
      lng: -73.874,
      formattedAddress: "LaGuardia Airport, Queens, NY",
      label: "LaGuardia Airport, Queens, NY",
    },
  },
  {
    label: "EWR",
    place: {
      lat: 40.6895,
      lng: -74.1745,
      formattedAddress: "Newark Liberty International Airport, NJ",
      label: "Newark Airport, NJ",
    },
  },
  {
    label: "Times Sq",
    place: {
      lat: 40.758,
      lng: -73.9855,
      formattedAddress: "Times Square, New York, NY",
      label: "Times Square, New York, NY",
    },
  },
  {
    label: "Grand Central",
    place: {
      lat: 40.7527,
      lng: -73.9772,
      formattedAddress: "Grand Central Terminal, New York, NY",
      label: "Grand Central Terminal, New York, NY",
    },
  },
  {
    label: "Brooklyn Bridge",
    place: {
      lat: 40.7061,
      lng: -73.9969,
      formattedAddress: "Brooklyn Bridge, New York, NY",
      label: "Brooklyn Bridge, New York, NY",
    },
  },
];

function loadRecent(): RecentRoute[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentRoute[];
  } catch {
    return [];
  }
}

function saveRecent(pickup: PlaceValue, destination: PlaceValue) {
  try {
    const next: RecentRoute = {
      id: `${pickup.lat},${pickup.lng}->${destination.lat},${destination.lng}`,
      pickup,
      destination,
      savedAt: Date.now(),
    };
    const prev = loadRecent().filter((r) => r.id !== next.id);
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([next, ...prev].slice(0, 6)),
    );
  } catch {
    /* private mode / quota */
  }
}

function encodePlace(p: PlaceValue): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${encodeURIComponent(p.formattedAddress)}`;
}

function decodePlace(raw: string | null): PlaceValue | null {
  if (!raw) return null;
  const [latS, lngS, ...rest] = raw.split(",");
  const lat = Number(latS);
  const lng = Number(lngS);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const label = decodeURIComponent(rest.join(",") || "Selected place");
  return { lat, lng, formattedAddress: label, label };
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function parseMode(raw: string | null): RankingMode {
  if (raw === "fastest" || raw === "best_value" || raw === "cheapest") return raw;
  return "cheapest";
}

function parseFilter(raw: string | null): FilterId {
  if (
    raw === "ALL" ||
    raw === "XL" ||
    raw === "PREMIUM" ||
    raw === "TAXI" ||
    raw === "standard"
  ) {
    return raw;
  }
  return "standard";
}

export function CompareForm({
  liveCapable,
}: {
  liveCapable: boolean;
}) {
  const [pickup, setPickup] = useState<PlaceValue | null>(null);
  const [destination, setDestination] = useState<PlaceValue | null>(null);
  const [locating, setLocating] = useState(false);
  const [session, setSession] = useState<QuoteSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterId>("standard");
  const [mode, setMode] = useState<RankingMode>("cheapest");
  const [mapRoute, setMapRoute] = useState<MapRoute | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [recent, setRecent] = useState<RecentRoute[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [quickTarget, setQuickTarget] = useState<"from" | "to">("to");

  const requestGen = useRef(0);
  const quotesAbort = useRef<AbortController | null>(null);
  const routeAbort = useRef<AbortController | null>(null);
  const pageVisible = useRef(true);
  const swapComparePending = useRef(false);
  const recentComparePending = useRef(false);
  const lastComparedKey = useRef<string | null>(null);
  const deepLinkCompareDone = useRef(false);
  const toFieldRef = useRef<PlaceFieldHandle | null>(null);

  const focusTo = useCallback(() => {
    window.setTimeout(() => toFieldRef.current?.focus(), 40);
  }, []);

  useEffect(() => {
    if (retryAfter == null || retryAfter <= 0) return;
    const id = window.setInterval(() => {
      setRetryAfter((n) => {
        if (n == null || n <= 1) return null;
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [retryAfter]);

  const canSubmit = Boolean(
    pickup &&
      destination &&
      Number.isFinite(pickup.lat) &&
      Number.isFinite(pickup.lng) &&
      Number.isFinite(destination.lat) &&
      Number.isFinite(destination.lng),
  );

  const routeKey =
    pickup && destination
      ? `${pickup.lat},${pickup.lng}->${destination.lat},${destination.lng}`
      : null;

  useEffect(() => {
    setRecent(loadRecent());
    const params = new URLSearchParams(window.location.search);
    const from = decodePlace(params.get("from"));
    const to = decodePlace(params.get("to"));
    if (from) setPickup(from);
    if (to) setDestination(to);
    setMode(parseMode(params.get("mode")));
    setFilter(parseFilter(params.get("filter")));
    setHydrated(true);

    const onVis = () => {
      pageVisible.current = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const fetchRoute = useCallback(async (from: PlaceValue, to: PlaceValue) => {
    routeAbort.current?.abort();
    const ac = new AbortController();
    routeAbort.current = ac;
    setMapRoute(null);
    setMapLoading(true);
    try {
      const qs = new URLSearchParams({
        fromLat: String(from.lat),
        fromLng: String(from.lng),
        toLat: String(to.lat),
        toLng: String(to.lng),
      });
      const res = await fetch(`/api/route?${qs}`, { signal: ac.signal });
      if (!res.ok) {
        setMapRoute(null);
        return;
      }
      const data = (await res.json()) as { route: MapRoute };
      if (!ac.signal.aborted) setMapRoute(data.route);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setMapRoute(null);
    } finally {
      if (!ac.signal.aborted) setMapLoading(false);
    }
  }, []);

  const useCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        let label = "Current location";
        try {
          const r = await fetch(`/api/places/reverse?lat=${lat}&lng=${lng}`);
          if (r.ok) {
            const data = (await r.json()) as {
              location?: { formattedAddress: string };
            };
            if (data.location?.formattedAddress) {
              label = data.location.formattedAddress;
            }
          }
        } catch {
          /* keep */
        }
        setPickup({ lat, lng, formattedAddress: label, label });
        setLocating(false);
        setQuickTarget("to");
        focusTo();
      },
      () => {
        setLocating(false);
        setError(
          "Location permission denied. Search for a pickup address instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [focusTo]);

  const toPayload = (p: PlaceValue) => ({
    lat: p.lat,
    lng: p.lng,
    placeId: p.placeId,
    formattedAddress: p.formattedAddress,
    query: p.formattedAddress,
  });

  const compare = useCallback(
    async (refresh = false) => {
      if (!pickup || !destination || !canSubmit) return;

      const dist = haversineMeters(pickup, destination);
      if (dist < NEAR_IDENTICAL_M) {
        setError(
          "Pickup and destination are nearly the same place. Choose a clearer destination.",
        );
        return;
      }

      quotesAbort.current?.abort();
      const ac = new AbortController();
      quotesAbort.current = ac;
      const gen = ++requestGen.current;
      const key = `${pickup.lat},${pickup.lng}->${destination.lat},${destination.lng}`;
      lastComparedKey.current = key;

      setLoading(true);
      setError(null);
      setRetryAfter(null);
      void fetchRoute(pickup, destination);
      saveRecent(pickup, destination);
      setRecent(loadRecent());

      const url = new URL(window.location.href);
      url.searchParams.set("from", encodePlace(pickup));
      url.searchParams.set("to", encodePlace(destination));
      url.searchParams.set("mode", mode);
      url.searchParams.set("filter", filter);
      window.history.replaceState({}, "", url.toString());

      const categoryFilter =
        filter === "standard" || filter === "ALL"
          ? filter
          : ([filter] as ("XL" | "PREMIUM" | "TAXI")[]);

      try {
        const res = await fetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            pickup: toPayload(pickup),
            destination: toPayload(destination),
            rankingMode: mode,
            categoryFilter,
            stream: true,
            refresh,
          }),
        });

        if (gen !== requestGen.current) return;

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            message?: string;
            error?: string;
            retryAfterSeconds?: number;
          };
          if (res.status === 429) {
            const secs = data.retryAfterSeconds ?? 60;
            setRetryAfter(secs);
            throw new Error(
              `Too many compares — try again in about ${secs}s.`,
            );
          }
          throw new Error(
            data.message || data.error || `Request failed (${res.status})`,
          );
        }

        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream") && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (gen !== requestGen.current) {
              await reader.cancel().catch(() => undefined);
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() || "";
            for (const chunk of chunks) {
              const line = chunk
                .split("\n")
                .find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const event = JSON.parse(line.slice(6)) as {
                  type: string;
                  session?: QuoteSession;
                  message?: string;
                };
                if (gen !== requestGen.current) return;
                if (event.session) setSession(event.session);
                if (event.type === "error")
                  setError(event.message || "Stream error");
              } catch {
                /* ignore malformed SSE */
              }
            }
          }
        } else {
          const data = (await res.json()) as { session: QuoteSession };
          if (gen === requestGen.current) setSession(data.session);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (gen === requestGen.current) {
          setError(e instanceof Error ? e.message : "Comparison failed");
        }
      } finally {
        if (gen === requestGen.current) setLoading(false);
      }
    },
    [pickup, destination, canSubmit, filter, mode, fetchRoute],
  );

  // Deep-link one-shot compare
  useEffect(() => {
    if (!hydrated || !pickup || !destination || deepLinkCompareDone.current)
      return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") && params.get("to")) {
      deepLinkCompareDone.current = true;
      void compare(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Auto-compare when both places newly selected (not already compared)
  useEffect(() => {
    if (!hydrated || !canSubmit || !routeKey || loading) return;
    if (lastComparedKey.current === routeKey) return;
    if (swapComparePending.current || recentComparePending.current) return;
    const t = window.setTimeout(() => {
      void compare(false);
    }, 280);
    return () => window.clearTimeout(t);
  }, [hydrated, canSubmit, routeKey, loading, compare]);

  useEffect(() => {
    if (!autoRefresh || !canSubmit) return;
    const id = window.setInterval(() => {
      if (!pageVisible.current) return;
      void compare(true);
    }, 45000);
    return () => window.clearInterval(id);
  }, [autoRefresh, canSubmit, compare]);

  useEffect(() => {
    return () => {
      quotesAbort.current?.abort();
      routeAbort.current?.abort();
    };
  }, []);

  const swapAndCompare = () => {
    if (!pickup && !destination) return;
    swapComparePending.current = Boolean(pickup && destination);
    setPickup(destination);
    setDestination(pickup);
    setMapRoute(null);
  };

  useEffect(() => {
    if (!swapComparePending.current) return;
    if (!pickup || !destination) return;
    swapComparePending.current = false;
    void compare(false);
  }, [pickup, destination, compare]);

  useEffect(() => {
    if (!recentComparePending.current) return;
    if (!pickup || !destination) return;
    recentComparePending.current = false;
    void compare(false);
  }, [pickup, destination, compare]);

  // Persist mode/filter in URL without re-fetch
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    url.searchParams.set("filter", filter);
    window.history.replaceState({}, "", url.toString());
  }, [mode, filter, hydrated]);

  // ⌘/Ctrl + Enter to compare; "/" focuses From when not typing in an input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!canSubmit || loading) return;
        e.preventDefault();
        void compare(false);
        return;
      }
      if (!typing && e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>(
          'input[aria-label="From"]',
        );
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSubmit, loading, compare]);

  const shareComparison = async () => {
    if (!pickup || !destination) return;
    const url = new URL(window.location.href);
    url.searchParams.set("from", encodePlace(pickup));
    url.searchParams.set("to", encodePlace(destination));
    url.searchParams.set("mode", mode);
    url.searchParams.set("filter", filter);
    const href = url.toString();
    const title = "RideLens comparison";
    const text = `${pickup.label.split(",")[0]} → ${destination.label.split(",")[0]}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text, url: href });
        setShareNote("Shared");
        window.setTimeout(() => setShareNote(null), 1600);
        return;
      }
      await navigator.clipboard.writeText(href);
      setShareNote("Link copied");
      window.setTimeout(() => setShareNote(null), 2000);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setShareNote("Couldn’t share — copy from the address bar");
      window.setTimeout(() => setShareNote(null), 2500);
    }
  };

  const applyQuickPick = (place: PlaceValue) => {
    if (quickTarget === "from" || !pickup) {
      setPickup(place);
      setQuickTarget("to");
      focusTo();
    } else {
      setDestination(place);
    }
  };

  const showMobileCompare =
    canSubmit && !loading && !(session && lastComparedKey.current === routeKey);

  const timeEyebrow = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "Late night · every ride, one comparison";
    if (h < 11) return "Morning · every ride, one comparison";
    if (h < 17) return "Afternoon · every ride, one comparison";
    if (h < 21) return "Evening · every ride, one comparison";
    return "Tonight · every ride, one comparison";
  }, []);

  const proximity = pickup
    ? { lat: pickup.lat, lng: pickup.lng }
    : { lat: 40.7128, lng: -74.006 };

  return (
    <div className="compare-root">
      <section className="hero-panel">
        <p className="eyebrow">{timeEyebrow}</p>
        <h1 className="brand">RideLens</h1>
        <p className="lede muted">
          Compare Uber, Lyft, Empower, and Curb before you book.
        </p>

        <div className="provider-strip" aria-label="Supported providers">
          {PROVIDERS.map((p) => (
            <span key={p} className="provider-strip-item">
              <ProviderLogo provider={p} size={24} />
              <span>{p.charAt(0).toUpperCase() + p.slice(1)}</span>
            </span>
          ))}
        </div>

        <div className="route-form">
          <div className="route-stack">
            <div className="route-rail" aria-hidden>
              <span className="route-dot from" />
              <span className="route-line" />
              <span className="route-dot to" />
            </div>
            <div className="route-fields">
              <PlaceField
                label="From"
                value={pickup}
                autoFocus
                onChange={(v) => {
                  setPickup(v);
                  if (v) setQuickTarget("to");
                }}
                onPinned={() => {
                  setQuickTarget("to");
                  if (!destination) focusTo();
                }}
                placeholder="Search pickup address"
                proximity={proximity}
              />
              <PlaceField
                ref={toFieldRef}
                label="To"
                value={destination}
                onChange={setDestination}
                placeholder="Search destination"
                proximity={proximity}
              />
            </div>
          </div>

          {!(pickup && destination) ? (
            <div className="quick-picks" role="group" aria-label="Quick places">
              <div className="quick-picks-head">
                <span className="muted">Quick fill</span>
                <div className="quick-target">
                  <button
                    type="button"
                    className={quickTarget === "from" ? "chip active" : "chip"}
                    onClick={() => setQuickTarget("from")}
                  >
                    From
                  </button>
                  <button
                    type="button"
                    className={quickTarget === "to" ? "chip active" : "chip"}
                    onClick={() => setQuickTarget("to")}
                  >
                    To
                  </button>
                </div>
              </div>
              <div className="quick-picks-row">
                {QUICK_PICKS.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    className="chip quick-chip"
                    onClick={() => applyQuickPick(q.place)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="route-actions">
            <button
              type="button"
              className="ghost"
              onClick={swapAndCompare}
              disabled={!pickup && !destination}
              title="Swap From and To"
            >
              Swap
            </button>
            <button
              type="button"
              className="ghost"
              onClick={useCurrentLocation}
              disabled={locating}
            >
              {locating ? "Locating…" : "Use current location"}
            </button>
            {pickup || destination || session ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  quotesAbort.current?.abort();
                  routeAbort.current?.abort();
                  setPickup(null);
                  setDestination(null);
                  setSession(null);
                  setMapRoute(null);
                  setError(null);
                  setRetryAfter(null);
                  lastComparedKey.current = null;
                  setQuickTarget("to");
                  const url = new URL(window.location.href);
                  url.searchParams.delete("from");
                  url.searchParams.delete("to");
                  window.history.replaceState({}, "", url.toString());
                }}
              >
                Clear route
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className={`primary${canSubmit && !loading ? " is-ready" : ""}`}
            disabled={!canSubmit || loading}
            onClick={() => compare(false)}
          >
            {loading ? "Comparing…" : "Compare rides"}
          </button>

          {!canSubmit ? (
            <p className="route-help muted">
              Pick From and To — or Quick fill. Press{" "}
              <kbd className="kbd">⌘</kbd>
              <kbd className="kbd">Enter</kbd> to compare.
            </p>
          ) : (
            <div className="route-tools">
              <label className="auto-refresh">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto-refresh every 45s
              </label>
              <button type="button" className="ghost" onClick={shareComparison}>
                Share
              </button>
              <span className="share-status muted" aria-live="polite">
                {shareNote || ""}
              </span>
            </div>
          )}
        </div>

        {recent.length > 0 ? (
          <div className="recent-routes">
            <p className="section-label">Recent</p>
            <ul>
              {recent.slice(0, 4).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      recentComparePending.current = true;
                      setPickup(r.pickup);
                      setDestination(r.destination);
                    }}
                  >
                    <span>{r.pickup.label.split(",")[0]}</span>
                    <span aria-hidden>→</span>
                    <span>{r.destination.label.split(",")[0]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!liveCapable ? (
          <p className="banner warn" role="status">
            Live provider feeds are not configured yet. Estimates still use
            routing and published rate cards when available.
          </p>
        ) : (
          <p className="banner quiet" role="status">
            Estimates use live roads and published rates. Confirm the final fare
            in the provider app.
          </p>
        )}

        {error ? (
          <div className="banner danger banner-with-action" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="ghost banner-retry"
              disabled={loading || (retryAfter != null && retryAfter > 0)}
              onClick={() => compare(true)}
            >
              {retryAfter != null && retryAfter > 0
                ? `Retry in ${retryAfter}s`
                : "Retry"}
            </button>
          </div>
        ) : null}
      </section>

      {session || loading || (pickup && destination) ? (
        <QuoteResults
          session={session}
          loading={loading}
          mode={mode}
          filter={filter}
          onModeChange={setMode}
          onFilterChange={setFilter}
          onRefresh={() => compare(true)}
          mapRoute={mapRoute}
          mapLoading={mapLoading}
          pickup={pickup}
          destination={destination}
        />
      ) : (
        <aside className="results-empty" aria-label="Getting started">
          <div className="results-empty-card">
            <div className="results-empty-orbit" aria-hidden>
              <span className="orbit-glow" />
              <div className="results-empty-logos">
                {PROVIDERS.map((p) => (
                  <ProviderLogo key={p} provider={p} size={32} />
                ))}
              </div>
            </div>
            <p className="results-empty-kicker">Ready when you are</p>
            <p className="results-empty-copy muted">
              Choose From and To — we’ll map the route and line up Uber, Lyft,
              Empower, and Curb side by side.
            </p>
          </div>
        </aside>
      )}

      {showMobileCompare ? (
        <div className="mobile-compare-bar">
          <button
            type="button"
            className="primary"
            disabled={!canSubmit || loading}
            onClick={() => compare(false)}
          >
            {loading ? "Comparing…" : "Compare rides"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
