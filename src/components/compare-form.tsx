"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlaceField, type PlaceFieldHandle, type PlaceValue } from "@/components/place-field";
import {
  saveRecent,
  useDeepLinkState,
  useDesktopAutofocus,
  useOnline,
  useRecentRoutes,
} from "@/components/use-deep-link-state";
import { QuoteResults } from "@/components/quote-results";
import { describeFailure } from "@/lib/domain/failure-message";
import { ProviderLogo } from "@/components/provider-logo";
import type { ProviderId, QuoteSession } from "@/lib/domain/types";
import type { MapRoute } from "@/components/route-map";
import { formatQuotePrice } from "@/lib/domain/money";
import { rankQuotes } from "@/lib/domain/ranking";

type RankingMode = "cheapest" | "fastest" | "best_value";
type FilterId = "standard" | "ALL" | "XL" | "PREMIUM" | "TAXI";

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

function encodePlace(p: PlaceValue): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${encodeURIComponent(p.formattedAddress)}`;
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function CompareForm({ liveCapable }: { liveCapable: boolean }) {
  /*
   * What the URL asks for, read during render rather than assigned in a mount
   * effect. Someone arriving on a deep link used to see an empty form for one
   * render before the effect filled it in.
   */
  const deepLink = useDeepLinkState();

  const [pickup, setPickup] = useState<PlaceValue | null>(() => deepLink.pickup);
  const [destination, setDestination] = useState<PlaceValue | null>(() => deepLink.destination);
  const [locating, setLocating] = useState(false);
  const [session, setSession] = useState<QuoteSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterId>(() => deepLink.filter);
  const [mode, setMode] = useState<RankingMode>(() => deepLink.mode);
  const [mapRoute, setMapRoute] = useState<MapRoute | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [quickTarget, setQuickTarget] = useState<"from" | "to">("to");
  const [swapping, setSwapping] = useState(false);
  /* localStorage and navigator.onLine, both read during render. */
  const recent = useRecentRoutes();
  const offline = !useOnline();
  /*
   * The URL is parsed during render, so hydration is complete on the first
   * one. Kept as a named constant because several effects below read it.
   */
  const hydrated = true;
  const desktopAutofocus = useDesktopAutofocus();
  const autoRefreshArmed = useRef(false);
  const refreshFailCount = useRef(0);
  const geoAbort = useRef<AbortController | null>(null);

  const requestGen = useRef(0);
  const quotesAbort = useRef<AbortController | null>(null);
  const routeAbort = useRef<AbortController | null>(null);
  const pageVisible = useRef(true);
  const onlineRef = useRef(true);
  /*
   * Two halves of one fact, on purpose.
   *
   * The ref is read inside async flows (fetchRoute, compare) where a stale
   * closure would compare against the wrong route. The state exists because
   * render reads this too — `showMobileCompare` below — and a ref mutation
   * schedules no re-render, so the mobile compare button could show or hide
   * based on a value React had never seen. Write through setLastCompared and
   * the two cannot drift.
   */
  const lastComparedKey = useRef<string | null>(null);
  const [comparedKey, setComparedKey] = useState<string | null>(null);
  const setLastCompared = useCallback((key: string | null) => {
    lastComparedKey.current = key;
    setComparedKey(key);
  }, []);
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

  /*
   * All that is left of the old mount effect.
   *
   * It used to also read the query string, localStorage, navigator.onLine and
   * two media queries, then call six setters — every one a synchronous
   * setState in an effect, forcing a second render of this whole tree before
   * anything appeared. Those four reads all have render-time answers now (see
   * use-deep-link-state.ts). Page visibility has no render-time answer and is
   * only ever read inside callbacks, so it stays a ref on a listener.
   */
  useEffect(() => {
    const onVis = () => {
      pageVisible.current = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const fetchRoute = useCallback(async (from: PlaceValue, to: PlaceValue) => {
    const key = `${from.lat},${from.lng}->${to.lat},${to.lng}`;
    routeAbort.current?.abort();
    const ac = new AbortController();
    routeAbort.current = ac;
    const keepExisting = lastComparedKey.current === key;
    if (!keepExisting) setMapRoute(null);
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
        if (!keepExisting) setMapRoute(null);
        return;
      }
      const data = (await res.json()) as { route: MapRoute };
      if (!ac.signal.aborted) setMapRoute(data.route);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!keepExisting) setMapRoute(null);
    } finally {
      if (!ac.signal.aborted) setMapLoading(false);
    }
  }, []);

  const useCurrentLocation = useCallback(() => {
    if (locating) {
      geoAbort.current?.abort();
      setLocating(false);
      return;
    }
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }
    setLocating(true);
    setError(null);
    geoAbort.current?.abort();
    const ac = new AbortController();
    geoAbort.current = ac;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        let label = "Current location";
        try {
          const r = await fetch(`/api/places/reverse?lat=${lat}&lng=${lng}`, { signal: ac.signal });
          if (ac.signal.aborted) return;
          if (r.ok) {
            const data = (await r.json()) as {
              location?: { formattedAddress: string };
            };
            if (data.location?.formattedAddress) {
              label = data.location.formattedAddress;
            }
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          /* keep */
        }
        if (ac.signal.aborted) return;
        setPickup({ lat, lng, formattedAddress: label, label });
        setLocating(false);
        setQuickTarget("to");
        focusTo();
      },
      (err) => {
        if (ac.signal.aborted) return;
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location permission denied. Search for a pickup address instead.");
        } else if (err.code === err.TIMEOUT) {
          setError("Location timed out. Try again or search for an address.");
        } else {
          setError("Couldn’t read your location. Search for a pickup address instead.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [focusTo, locating]);

  const toPayload = (p: PlaceValue) => ({
    lat: p.lat,
    lng: p.lng,
    placeId: p.placeId,
    formattedAddress: p.formattedAddress,
    query: p.formattedAddress,
  });

  const compare = useCallback(
    async (refresh = false, override?: { pickup: PlaceValue; destination: PlaceValue }) => {
      /*
       * One invariant, and three effects stop cascading because of it:
       * `compare` never mutates state in its caller's synchronous frame.
       *
       * Three callers below are effects — the deep-link one-shot, and the
       * re-compare after a swap or a recent-route pick. Each is an *action*
       * triggered by something that happened, not state derived during
       * render, so an effect is the right home for them. What is not right is
       * setLoading firing inside the effect body and forcing a second render
       * of this tree before the first has painted. Yielding once moves every
       * update below into a later tick, where it belongs.
       *
       * Imperceptible for a button press, and it costs nothing: the fetch that
       * follows is orders of magnitude slower than a microtask.
       */
      await null;

      /*
       * Endpoints may be handed in. Swapping, or picking a recent route, sets
       * two pieces of state and then wants to compare the result — but the new
       * values are not readable from this closure until React re-renders. That
       * used to be bridged with a pending ref plus an effect watching for the
       * state to land; passing them directly says the same thing in one line
       * and deletes both.
       */
      const from = override?.pickup ?? pickup;
      const to = override?.destination ?? destination;
      if (!from || !to || (!override && !canSubmit)) return;

      const dist = haversineMeters(from, to);
      if (dist < NEAR_IDENTICAL_M) {
        /* Read as broken English — "Choose a clearer to" — which is what a
           rename of the destination field to "To" left behind. */
        setError("Pickup and destination are nearly the same place. Pick somewhere to go.");
        setSession(null);
        setMapRoute(null);
        setLastCompared(null);
        return;
      }

      quotesAbort.current?.abort();
      const ac = new AbortController();
      quotesAbort.current = ac;
      const gen = ++requestGen.current;
      const key = `${from.lat},${from.lng}->${to.lat},${to.lng}`;
      if (!refresh && lastComparedKey.current !== key) {
        setSession(null);
      }
      setLastCompared(key);

      setLoading(true);
      setError(null);
      setRetryAfter(null);
      void fetchRoute(from, to);
      // saveRecent dispatches its own change event; useRecentRoutes is
      // subscribed, so there is nothing to re-read by hand.
      saveRecent(from, to);

      const url = new URL(window.location.href);
      url.searchParams.set("from", encodePlace(from));
      url.searchParams.set("to", encodePlace(to));
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
            pickup: toPayload(from),
            destination: toPayload(to),
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
            throw new Error(`Too many compares — try again in about ${secs}s.`);
          }
          /* Tagged so describeFailure can tell a 503 from a dropped
             connection without re-parsing a sentence. */
          const err = new Error(data.message || data.error || `Request failed (${res.status})`);
          (err as Error & { status?: number }).status = res.status;
          throw err;
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
              const line = chunk.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const event = JSON.parse(line.slice(6)) as {
                  type: string;
                  session?: QuoteSession;
                  message?: string;
                };
                if (gen !== requestGen.current) return;
                if (event.session) {
                  setSession(event.session);
                  if (event.session.status === "SUCCESS" || event.session.status === "PARTIAL") {
                    refreshFailCount.current = 0;
                  }
                  if (event.session.status === "SUCCESS" && !autoRefreshArmed.current) {
                    autoRefreshArmed.current = true;
                    setAutoRefresh(true);
                    setShareNote("Auto-refresh on: turn off anytime");
                    window.setTimeout(() => setShareNote(null), 3200);
                  }
                }
                if (event.type === "error") setError(event.message || "Stream error");
              } catch {
                /* ignore malformed SSE */
              }
            }
          }
        } else {
          const data = (await res.json()) as { session: QuoteSession };
          if (gen === requestGen.current) {
            setSession(data.session);
            if (data.session.status === "SUCCESS" || data.session.status === "PARTIAL") {
              refreshFailCount.current = 0;
            }
            if (data.session.status === "SUCCESS" && !autoRefreshArmed.current) {
              autoRefreshArmed.current = true;
              setAutoRefresh(true);
              setShareNote("Auto-refresh on: turn off anytime");
              window.setTimeout(() => setShareNote(null), 3200);
            }
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (gen === requestGen.current) {
          refreshFailCount.current += 1;
          /*
           * "Failed to fetch" was reaching the screen verbatim. A browser's
           * own words are not a thing to show a person — see
           * src/lib/domain/failure-message.ts.
           */
          const status = (e as Error & { status?: number })?.status;
          const described = describeFailure(e, onlineRef.current, status);
          setError(described.detail ? `${described.title}. ${described.detail}` : described.title);
          if (refresh && refreshFailCount.current >= 3 && autoRefresh) {
            setAutoRefresh(false);
            setShareNote("Auto-refresh paused after repeated errors");
            window.setTimeout(() => setShareNote(null), 3600);
          }
        }
      } finally {
        if (gen === requestGen.current) setLoading(false);
      }
    },
    [pickup, destination, canSubmit, filter, mode, fetchRoute, autoRefresh, setLastCompared],
  );

  /*
   * Someone arriving on a shared link expects the comparison already running.
   *
   * The two effects that used to sit beside this one are gone — they were
   * derived state and an action waiting on a ref, and both had render-time
   * answers. This one does not: it is a fetch that must happen once, on
   * arrival, because of how the page was opened. That is the case effects
   * exist for, and there is no render-time expression for "go and ask the
   * network".
   *
   * The rule fires because `compare` eventually calls setLoading. It is aimed
   * at derived-state cascades, and suppressing it anywhere else in this file
   * would have been hiding a real problem; here it is describing one that is
   * not. The proper removal is 4.4 — let the server render the result for a
   * deep link — at which point this effect goes too.
   */
  useEffect(() => {
    if (!deepLink.hasRoute || deepLinkCompareDone.current) return;
    deepLinkCompareDone.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on arrival; see above
    void compare(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink.hasRoute]);

  /*
   * Whether the session on screen still describes the route in the fields.
   *
   * This used to be an effect that watched pickup/destination and called
   * setSession(null) when they moved — derived state maintained by hand, which
   * is both a cascading render and a frame in which the old comparison is
   * still on screen under the new addresses. Comparing the two keys during
   * render answers the same question before anything is painted.
   */
  const sessionIsCurrent =
    session !== null && comparedKey !== null && routeKey !== null && comparedKey === routeKey;
  const activeSession = sessionIsCurrent ? session : null;

  // Auto-compare when both places newly selected (not already compared)
  useEffect(() => {
    if (!hydrated || !canSubmit || !routeKey || loading) return;
    if (lastComparedKey.current === routeKey) return;
    const t = window.setTimeout(() => {
      void compare(false);
    }, 280);
    return () => window.clearTimeout(t);
  }, [hydrated, canSubmit, routeKey, loading, compare]);

  useEffect(() => {
    if (!autoRefresh || !canSubmit) return;
    const id = window.setInterval(() => {
      if (!pageVisible.current) return;
      if (!onlineRef.current) return;
      if (refreshFailCount.current >= 3) return;
      void compare(true);
    }, 55000);
    return () => window.clearInterval(id);
  }, [autoRefresh, canSubmit, compare]);

  useEffect(() => {
    return () => {
      quotesAbort.current?.abort();
      routeAbort.current?.abort();
      geoAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!pickup || !destination) {
      document.title = "RideLens · Every ride. One comparison.";
      return;
    }
    const a = pickup.label.split(",")[0];
    const b = destination.label.split(",")[0];
    document.title = `${a} → ${b} · RideLens`;
    return () => {
      document.title = "RideLens · Every ride. One comparison.";
    };
  }, [pickup, destination]);

  const swapAndCompare = () => {
    if (!pickup && !destination) return;
    setSwapping(true);
    window.setTimeout(() => setSwapping(false), 450);
    const swappedPickup = destination;
    const swappedDestination = pickup;
    setPickup(swappedPickup);
    setDestination(swappedDestination);
    if (swappedPickup && swappedDestination) {
      void compare(false, { pickup: swappedPickup, destination: swappedDestination });
    }
  };

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
        const el = document.querySelector<HTMLInputElement>('input[aria-label="From"]');
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
    const routeLine = `${pickup.label.split(",")[0]} → ${destination.label.split(",")[0]}`;
    let text = routeLine;
    if (activeSession?.quotes?.length) {
      const best = rankQuotes(
        activeSession.quotes,
        mode,
        filter === "standard" || filter === "ALL" ? filter : [filter as "XL" | "PREMIUM" | "TAXI"],
      )[0];
      if (best) {
        text = `${routeLine} · Best: ${best.providerProductName} ${formatQuotePrice(best)}`;
      }
    }
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text, url: href });
        setShareNote("Shared");
        window.setTimeout(() => setShareNote(null), 1600);
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${href}`);
      setShareNote("Link + best fare copied");
      window.setTimeout(() => setShareNote(null), 2000);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setShareNote("Couldn’t share: copy from the address bar");
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

  const showMobileCompare = canSubmit && !loading && !(activeSession && comparedKey === routeKey);
  const compareReadyPulse = showMobileCompare;

  const timeEyebrow = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "Late night · every ride, one comparison";
    if (h < 11) return "Morning · every ride, one comparison";
    if (h < 17) return "Afternoon · every ride, one comparison";
    if (h < 21) return "Evening · every ride, one comparison";
    return "Tonight · every ride, one comparison";
  }, []);

  const isApplePlatform = useMemo(() => {
    if (typeof navigator === "undefined") return true;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  }, []);

  const proximity = pickup ? { lat: pickup.lat, lng: pickup.lng } : { lat: 40.7128, lng: -74.006 };

  return (
    <div className="compare-root">
      <section className="hero-panel" aria-labelledby="brand-heading">
        <p className="eyebrow">{timeEyebrow}</p>
        <h1 className="brand" id="brand-heading">
          RideLens
        </h1>
        <p className="lede muted">
          Live roads. Real rate cards. A marketplace that moves with the clock — before you open
          Uber, Lyft, Empower, or Curb.
        </p>

        <div className="provider-strip" aria-label="Supported providers">
          {PROVIDERS.map((p) => (
            <span key={p} className="provider-strip-item">
              <ProviderLogo provider={p} size={24} priority />
              <span>{p.charAt(0).toUpperCase() + p.slice(1)}</span>
            </span>
          ))}
        </div>

        <h2 id="route-heading" className="sr-only">
          Your route
        </h2>
        <div className="route-form" aria-labelledby="route-heading">
          <div className="route-stack">
            <div className="route-rail" aria-hidden>
              <span className="route-dot from" />
              <span className="route-line" />
              <span className="route-dot to" />
            </div>
            <div className={`route-fields${swapping ? " is-swapping" : ""}`}>
              <PlaceField
                label="From"
                value={pickup}
                autoFocus={desktopAutofocus}
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

          <div
            className={`quick-picks${pickup && destination ? " is-compact" : ""}`}
            role="group"
            aria-label="Quick places"
          >
            <div className="quick-picks-head">
              <span className="muted">Quick fill</span>
              <div className="quick-target">
                <button
                  type="button"
                  className={quickTarget === "from" ? "chip active" : "chip"}
                  aria-pressed={quickTarget === "from"}
                  onClick={() => setQuickTarget("from")}
                >
                  From
                </button>
                <button
                  type="button"
                  className={quickTarget === "to" ? "chip active" : "chip"}
                  aria-pressed={quickTarget === "to"}
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

          <div className="route-actions">
            <button
              type="button"
              className={`ghost${swapping ? " is-swapping" : ""}`}
              onClick={swapAndCompare}
              disabled={!pickup && !destination}
              title="Swap From and To"
            >
              Swap
            </button>
            <button type="button" className="ghost" onClick={useCurrentLocation}>
              {locating ? "Cancel locating" : "Use current location"}
            </button>
            {pickup || destination || activeSession ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  quotesAbort.current?.abort();
                  routeAbort.current?.abort();
                  geoAbort.current?.abort();
                  setPickup(null);
                  setDestination(null);
                  setSession(null);
                  setMapRoute(null);
                  setError(null);
                  setRetryAfter(null);
                  setAutoRefresh(false);
                  autoRefreshArmed.current = false;
                  refreshFailCount.current = 0;
                  setLastCompared(null);
                  setQuickTarget("to");
                  const url = new URL(window.location.href);
                  url.searchParams.delete("from");
                  url.searchParams.delete("to");
                  url.searchParams.delete("mode");
                  url.searchParams.delete("filter");
                  window.history.replaceState({}, "", url.toString());
                }}
              >
                Clear route
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className={`primary${compareReadyPulse ? " is-ready" : ""}`}
            disabled={!canSubmit || loading || offline}
            onClick={() => compare(false)}
          >
            {loading ? "Comparing…" : offline ? "Offline" : "Compare rides"}
          </button>

          {!canSubmit ? (
            <p className="route-help muted">
              Pick From and To, or Quick fill. Press{" "}
              <kbd className="kbd">{isApplePlatform ? "⌘" : "Ctrl"}</kbd>
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
                Auto-refresh every 55s
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
                      setPickup(r.pickup);
                      setDestination(r.destination);
                      void compare(false, {
                        pickup: r.pickup,
                        destination: r.destination,
                      });
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

        {offline ? (
          <div className="banner warn" role="status">
            <p>
              You’re offline. Saved route and recent places still work locally — compare needs a
              connection.
            </p>
          </div>
        ) : null}

        {!liveCapable ? (
          <p className="banner warn" role="status">
            Live provider feeds are not configured yet. Estimates still use routing and published
            rate cards when available.
          </p>
        ) : (
          <p className="banner quiet" role="status">
            Estimates update with traffic, time of day, hotspots, and weather. Final fare is always
            confirmed in the provider app.
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
              {retryAfter != null && retryAfter > 0 ? `Retry in ${retryAfter}s` : "Retry"}
            </button>
          </div>
        ) : null}
      </section>

      {activeSession || loading || (pickup && destination && !error) ? (
        <QuoteResults
          session={activeSession}
          loading={loading || Boolean(pickup && destination && !activeSession && !error)}
          mode={mode}
          filter={filter}
          onModeChange={setMode}
          onFilterChange={setFilter}
          onRefresh={() => compare(true)}
          onReverseTrip={
            pickup && destination
              ? () => {
                  swapAndCompare();
                }
              : undefined
          }
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
              Choose From and To: we’ll map the route and line up Uber, Lyft, Empower, and Curb side
              by side.
            </p>
          </div>
          <p className="results-empty-mobile muted">
            Pin From and To above, then Compare to see every ride side by side.
          </p>
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
