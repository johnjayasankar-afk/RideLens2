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

/** Minimal MapLibre surface used by this component (loaded from CDN). */
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

declare global {
  interface Window {
    maplibregl?: MapLibreGlobal;
  }
}

const STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const CSS_HREF = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
const JS_HREF = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

/**
 * Subresource integrity for the two files above.
 *
 * This injects 800 KB of third-party JavaScript from a public CDN and runs it
 * on this origin. Without an integrity hash, anything unpkg serves for that
 * path executes with full access to the page, and the CSP that permits it is
 * report-only — so nothing was checking anything.
 *
 * Derived from the npm registry's own published tarball for
 * maplibre-gl@4.7.1, whose dist.integrity
 * (sha512-lgL7XpIwsgICiL82ITplfS7IGwrB1OJIw/pCvprDp2dhmSSEBgmPzYRvwYYYvJGJD7fxUv1Tvpih4nZ6VrLuaA==)
 * was verified against the downloaded bytes, which are in turn byte-identical
 * to what unpkg serves. The hashes are therefore pinned to what npm published
 * rather than to whatever a CDN happened to return on the day.
 *
 * Bumping the version means regenerating both, the same way:
 *   npm view maplibre-gl@<v> dist.integrity   # verify the tarball first
 *   openssl dgst -sha384 -binary <file> | openssl base64 -A
 *
 * A mismatch makes the browser refuse the file and the map degrades to its
 * fallback, which is the correct outcome.
 */
const CSS_SRI = "sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V";
const JS_SRI = "sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj";

let loader: Promise<MapLibreGlobal> | null = null;

function loadMapLibre(): Promise<MapLibreGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MapLibre requires a browser"));
  }
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${CSS_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS_HREF;
      link.integrity = CSS_SRI;
      // Required for the browser to check integrity on a cross-origin file.
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[src="${JS_HREF}"]`) as HTMLScriptElement | null;
    const done = () => {
      if (window.maplibregl) resolve(window.maplibregl);
      else reject(new Error("MapLibre failed to load"));
    };
    if (existing) {
      if (window.maplibregl) done();
      else existing.addEventListener("load", done);
      return;
    }
    const script = document.createElement("script");
    script.src = JS_HREF;
    script.integrity = JS_SRI;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.onload = done;
    script.onerror = () => reject(new Error("MapLibre script error"));
    document.head.appendChild(script);
  });
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

  const pickupLat = pickup.lat;
  const pickupLng = pickup.lng;
  const pickupLabel = pickup.label;
  const destLat = destination.lat;
  const destLng = destination.lng;
  const destLabel = destination.label;

  useEffect(() => {
    let cancelled = false;
    loadMapLibre()
      .then((ml) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        libRef.current = ml;
        const map = new ml.Map({
          container: containerRef.current,
          style: STYLE,
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

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      const map = mapRef.current as (MlMap & { __rlCleanup?: () => void }) | null;
      map?.__rlCleanup?.();
      map?.remove();
      mapRef.current = null;
    };
    // Intentionally mount once; markers/route update in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
