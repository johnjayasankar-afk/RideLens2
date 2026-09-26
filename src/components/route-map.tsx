"use client";

import { useEffect, useRef, useState } from "react";

export type MapRoute = {
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  bbox: [number, number, number, number];
  miles: number;
  minutes: number;
};

type Props = {
  pickup: { lat: number; lng: number; label: string };
  destination: { lat: number; lng: number; label: string };
  route: MapRoute | null;
  loading?: boolean;
};

/** The slice of MapLibre this component actually touches. */
type MlMap = {
  addControl: (c: unknown, pos?: string) => void;
  on: (event: string, fn: () => void) => void;
  once: (event: string, fn: () => void) => void;
  remove: () => void;
  resize: () => void;
  isStyleLoaded: () => boolean;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  addSource: (id: string, source: unknown) => void;
  addLayer: (layer: unknown) => void;
  fitBounds: (bounds: unknown, opts: unknown) => void;
};

type MlMarker = { remove: () => void };

type MapLibreGlobal = {
  Map: new (opts: Record<string, unknown>) => MlMap;
  Marker: new (opts: { element: HTMLElement }) => {
    setLngLat: (ll: [number, number]) => {
      setPopup: (p: unknown) => {
        addTo: (map: MlMap) => MlMarker;
      };
    };
  };
  Popup: new (opts: Record<string, unknown>) => {
    setText: (t: string) => unknown;
  };
  NavigationControl: new (opts: Record<string, unknown>) => unknown;
  AttributionControl: new (opts: Record<string, unknown>) => unknown;
  LngLatBounds: new () => {
    extend: (c: [number, number]) => void;
  };
};

/**
 * Which basemap, from the page's own scheme.
 *
 * Read off the `--map-style` custom property rather than re-deriving the
 * scheme here. That property already resolves the whole rule — system
 * preference, plus a manual override that the system must not overrule —
 * and having two answers to "is this dark" is how they end up disagreeing.
 */
const STYLES: Record<string, string> = {
  positron: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  "dark-matter": "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

function currentStyleUrl(): string {
  if (typeof window === "undefined") return STYLES.positron!;
  const name = getComputedStyle(document.documentElement)
    .getPropertyValue("--map-style")
    .trim()
    .replace(/^["']|["']$/g, "");
  return STYLES[name] ?? STYLES.positron!;
}

/**
 * Loaded from the bundle, on demand.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This used to inject a <script> from unpkg.com and read window.maplibregl │
 * │ off the global. That ran 800 KB of third-party code on this origin, was  │
 * │ an uptime dependency on a CDN, and — the part that mattered — was        │
 * │ invisible to npm audit. The moment maplibre-gl became a real dependency, │
 * │ audit reported a *critical* XSS advisory against every version at or     │
 * │ below 6.4.0, which included the 4.7.1 this had been serving to users all │
 * │ along. Nothing in the project could have told anyone.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `import()` rather than a top-level import so the module still arrives only
 * when a map is actually rendered — it is the largest single thing this app
 * ships, and nothing on first paint needs it. See docs/PERFORMANCE.md.
 */
let loader: Promise<MapLibreGlobal> | null = null;

function loadMapLibre(): Promise<MapLibreGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MapLibre requires a browser"));
  }
  if (loader) return loader;
  // v6 exports its classes by name; there is no default export.
  loader = import("./map-lib").then((m) => m as unknown as MapLibreGlobal);
  return loader;
}

function makePin(color: string, letter: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "rl-map-pin";
  el.innerHTML = `<span style="--pin:${color}">${letter}</span>`;
  return el;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function RouteMap({ pickup, destination, route, loading }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<MlMarker[]>([]);
  const libRef = useRef<MapLibreGlobal | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /*
   * Changing this rebuilds the map rather than calling setStyle, because
   * setStyle discards every layer and source and the route line would have
   * to be re-added on a styledata event. A scheme change is a deliberate,
   * rare click; a rebuild is the boring correct thing.
   */
  const [styleUrl, setStyleUrl] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setStyleUrl(currentStyleUrl());
    sync();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    window.addEventListener("ridelens:themechange", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("ridelens:themechange", sync);
    };
  }, []);

  const pickupLat = pickup.lat;
  const pickupLng = pickup.lng;
  const pickupLabel = pickup.label;
  const destLat = destination.lat;
  const destLng = destination.lng;
  const destLabel = destination.label;

  useEffect(() => {
    let cancelled = false;
    const startMap = () =>
      loadMapLibre()
        .then((ml) => {
          if (cancelled || !containerRef.current || mapRef.current) return;
          libRef.current = ml;
          const map = new ml.Map({
            container: containerRef.current,
            style: styleUrl ?? currentStyleUrl(),
            center: [pickupLng, pickupLat],
            zoom: 11,
            attributionControl: false,
            cooperativeGestures: true,
          });
          map.addControl(new ml.NavigationControl({ visualizePitch: false }), "top-right");
          map.addControl(new ml.AttributionControl({ compact: true }), "bottom-right");
          map.on("load", () => {
            setReady(true);
            map.resize();
          });
          map.on("error", () => setFailed(true));
          mapRef.current = map;

          const ro =
            typeof ResizeObserver !== "undefined"
              ? new ResizeObserver(() => {
                  map.resize();
                })
              : null;
          if (containerRef.current && ro) ro.observe(containerRef.current);
          const onWinResize = () => map.resize();
          window.addEventListener("resize", onWinResize);
          (map as MlMap & { __rlCleanup?: () => void }).__rlCleanup = () => {
            ro?.disconnect();
            window.removeEventListener("resize", onWinResize);
          };
        })
        .catch(() => setFailed(true));

    /*
     * ── The map is never built while somebody is scrolling ────────────────
     *
     * Creating a WebGL map, compiling the style's layers and decoding the
     * first tiles is the heaviest thing on this page by a distance: ~650 ms
     * of long tasks out of ~820 ms total, against ~170 ms with the map
     * blocked. None of it delays first paint, because the module is lazy.
     * It lands *after* the comparison is on screen — which is exactly when
     * somebody starts scrolling it.
     *
     * Measured scrolling from the moment the cards appear, the worst frame
     * was 1.6 seconds. The median was a healthy 119 fps and it did not
     * matter at all: one frozen second is the thing a person remembers.
     *
     * requestIdleCallback alone does not fix it, because its timeout fires
     * regardless — straight into the scroll it was meant to avoid. So the
     * rule is explicit: if the page has scrolled recently, hand the slot
     * back and ask again. The map is supplementary (no task in this product
     * needs it — docs/A11Y.md), so making it wait for stillness costs
     * nothing, and DEADLINE_MS guarantees it always arrives.
     */
    const QUIET_MS = 220;
    const DEADLINE_MS = 8000;
    const began = Date.now();
    let lastScroll = 0;
    const noteScroll = () => {
      lastScroll = Date.now();
    };
    window.addEventListener("scroll", noteScroll, { passive: true });

    let handle = 0;
    let timer = 0;
    const clearPending = () => {
      if (handle && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(handle);
      }
      handle = 0;
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };

    /*
     * And never for a map nobody is looking at.
     *
     * On a phone the map sits below the comparison, so a rider who never
     * scrolls to it paid a second of frozen main thread for a WebGL context
     * they never saw. `rootMargin` starts it just before it arrives, so it
     * is drawn by the time it is.
     */
    let onScreen = true;
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function" && containerRef.current) {
      onScreen = false;
      io = new IntersectionObserver(
        (entries) => {
          if (!entries[0]?.isIntersecting) return;
          onScreen = true;
          io?.disconnect();
          io = null;
          attempt();
        },
        { rootMargin: "300px" },
      );
      io.observe(containerRef.current);
    }

    const attempt = () => {
      if (cancelled || mapRef.current) return;
      const outOfTime = Date.now() - began > DEADLINE_MS;
      if (!onScreen && !outOfTime) return; // the observer will call back
      const stillScrolling = Date.now() - lastScroll < QUIET_MS;
      if (stillScrolling && !outOfTime) {
        timer = window.setTimeout(attempt, QUIET_MS);
        return;
      }
      window.removeEventListener("scroll", noteScroll);
      io?.disconnect();
      io = null;
      void startMap();
    };

    if (typeof window.requestIdleCallback === "function") {
      handle = window.requestIdleCallback(attempt, { timeout: 1500 });
    } else {
      timer = window.setTimeout(attempt, 200);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("scroll", noteScroll);
      io?.disconnect();
      io = null;
      clearPending();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      const map = mapRef.current as (MlMap & { __rlCleanup?: () => void }) | null;
      map?.__rlCleanup?.();
      map?.remove();
      mapRef.current = null;
    };
    // Intentionally mount once; markers/route update in the effect below.
    // Rebuilds on a scheme change; the rest is mount-once by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    const ml = libRef.current;
    if (!map || !ml || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const a = new ml.Marker({ element: makePin("#1f6b4a", "A") })
      .setLngLat([pickupLng, pickupLat])
      .setPopup(new ml.Popup({ offset: 18, closeButton: false }).setText(pickupLabel))
      .addTo(map);
    const b = new ml.Marker({ element: makePin("#1d4e84", "B") })
      .setLngLat([destLng, destLat])
      .setPopup(new ml.Popup({ offset: 18, closeButton: false }).setText(destLabel))
      .addTo(map);
    markersRef.current = [a, b];

    const sourceId = "ridelens-route";
    const glowId = "ridelens-route-glow";
    const lineId = "ridelens-route-line";

    const applyRoute = () => {
      const coords =
        route?.geometry.coordinates?.length && route.geometry.coordinates.length >= 2
          ? route.geometry.coordinates
          : ([
              [pickupLng, pickupLat],
              [destLng, destLat],
            ] as [number, number][]);

      const geojson = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      };

      const existing = map.getSource(sourceId);
      if (existing) {
        existing.setData(geojson);
      } else {
        map.addSource(sourceId, { type: "geojson", data: geojson });
        map.addLayer({
          id: glowId,
          type: "line",
          source: sourceId,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#6ee7b7",
            "line-width": 10,
            "line-opacity": 0.45,
            "line-blur": 2,
          },
        });
        map.addLayer({
          id: lineId,
          type: "line",
          source: sourceId,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#1f6b4a",
            "line-width": 3.5,
            "line-opacity": 0.95,
          },
        });
      }

      const bounds = new ml.LngLatBounds();
      coords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds, {
        padding: { top: 56, bottom: 56, left: 48, right: 48 },
        duration: prefersReducedMotion() ? 0 : 900,
        maxZoom: 13.5,
      });
    };

    if (map.isStyleLoaded()) applyRoute();
    else map.once("idle", applyRoute);
  }, [ready, pickupLat, pickupLng, pickupLabel, destLat, destLng, destLabel, route]);

  return (
    <div
      className={`route-map-shell${loading ? " is-loading" : ""}${failed ? " is-failed" : ""}`}
      role="img"
      aria-label={
        route
          ? `Route from ${pickupLabel} to ${destLabel}, ${route.miles.toFixed(1)} miles, about ${route.minutes} minutes`
          : loading
            ? `Tracing route from ${pickupLabel} to ${destLabel}`
            : `Map from ${pickupLabel} to ${destLabel}`
      }
    >
      <div ref={containerRef} className="route-map-canvas" aria-hidden />
      {loading && !failed ? (
        <div className="route-map-overlay" aria-live="polite">
          <span className="place-spinner" />
          <span>Tracing route…</span>
        </div>
      ) : null}
      <div className="route-map-hud" aria-hidden>
        <div className="route-map-hud-row">
          <span className="pin-a">A</span>
          <span className="hud-label">{pickupLabel}</span>
        </div>
        <div className="route-map-hud-row">
          <span className="pin-b">B</span>
          <span className="hud-label">{destLabel}</span>
        </div>
        {route ? (
          <div className="route-map-stats">
            <span>{route.miles.toFixed(1)} mi</span>
            <span aria-hidden>·</span>
            <span>~{route.minutes} min</span>
          </div>
        ) : loading ? (
          <div className="route-map-stats muted">Tracing route…</div>
        ) : (
          <div className="route-map-stats muted">Route unavailable</div>
        )}
      </div>
      {failed ? (
        <p className="route-map-fallback muted">Map tiles unavailable: route stats still apply.</p>
      ) : null}
    </div>
  );
}
