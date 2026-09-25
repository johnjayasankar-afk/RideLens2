'use client';

/**
 * Route map.
 *
 * Supporting context that earns its space: the two endpoints, the road the
 * ride actually takes, and — when a bike quote is on screen — the live docking
 * stations along the corridor with their current bike counts.
 *
 * What it deliberately does NOT show is provider vehicle positions. There is no
 * legitimate live driver feed here, and inventing moving dots would be theatre
 * dressed as information. Every marker on this map corresponds to something
 * real that a source actually reported.
 *
 * The route line draws itself in once, briefly, so the eye follows the path
 * rather than having it appear fully formed. That is the only animation.
 */
// Loaded with this component rather than in globals.css: 69KB of stylesheet
// for a map that only exists once a comparison has run. Without it the canvas
// renders blank, so it belongs here and nowhere else.
import 'maplibre-gl/dist/maplibre-gl.css';
import type maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RouteGeometry } from '@/location/routing';
import type { CanonicalLocation } from '@/location/types';

export interface MapStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bikes: number;
  docks: number;
}

interface Props {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  geometry: RouteGeometry | null;
  stations?: MapStation[];
  height?: number;
}

interface MapHandle {
  remove: () => void;
  getSource: (id: string) => { setData: (d: unknown) => void } | undefined;
  setPaintProperty: (layer: string, prop: string, value: unknown) => void;
  getLayer: (id: string) => unknown;
  fitBounds: (b: [[number, number], [number, number]], o?: Record<string, unknown>) => void;
  resize: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

/**
 * The basemap.
 *
 * OpenStreetMap's own raster tiles, which need no key and no account. CARTO's
 * light/dark basemaps would match the interface better, but they now return a
 * tile stamped "API KEY REQUIRED" to unauthenticated callers — a map that says
 * that is worse than one that is merely bright, and inventing a key is not on
 * the table. See docs/FAILURE_MODES.md for what a production deployment should
 * move to.
 */
function basemap(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

/**
 * Tone the basemap to the interface.
 *
 * A bright street map inside a dark page reads as a hole punched in it. The CSS
 * trick for this is `filter: invert()`, but the route and the station dots are
 * drawn into the same canvas and would invert with it. Raster paint properties
 * apply to the tile layer alone, so the map recedes while everything drawn on
 * top keeps its colour.
 *
 * Opacity rather than brightness: `raster-brightness-max` had no visible effect
 * on this build, whereas dropping opacity blends the tiles toward the container
 * behind them, which is the app's own surface colour. The street network stays
 * legible; it simply stops shouting.
 */
function applyTone(map: MapHandle, dark: boolean): void {
  if (!map.getLayer('base')) return;
  // Raster opacity, blending the tiles toward the container behind them.
  //
  // Two other approaches were tried and are recorded here so they are not
  // tried again. A CSS `filter: invert()` on `.maplibregl-canvas` gives a
  // properly dark map but recolours everything in that canvas — the route, its
  // casing and the station dots are drawn there too, so the brand green
  // arrived as something else and a near-black casing rendered pale. And a
  // MapLibre `background` layer inserted above the raster does nothing:
  // background layers always paint at the very bottom, whatever their position
  // in the layer array. Raster paint properties are the only mechanism that
  // reaches the tiles alone.
  map.setPaintProperty('base', 'raster-opacity', dark ? 0.34 : 0.95);
  map.setPaintProperty('base', 'raster-saturation', dark ? -0.4 : -0.1);
  map.setPaintProperty('base', 'raster-contrast', dark ? 0.1 : 0);
  if (map.getLayer('route-casing')) {
    // The casing separates the route from the streets under it, so it wants to
    // be the opposite of the map, not the opposite of the page.
    map.setPaintProperty('route-casing', 'line-color', dark ? '#05070a' : '#ffffff');
  }
}

/**
 * Breathing room around the route when the map frames it.
 *
 * Map pixels, not CSS: this is a MapLibre camera option and has nothing to do
 * with the layout spacing scale, which is why it is a plain number here.
 */
const MAP_FIT_PADDING = 46;

/** The route's colour, shared with the endpoint markers and the legend dot. */
const ROUTE_COLOR = '#12b981';

/** Bike stations. Blue, so it can never be confused with the route. */
const STATION_COLOR = '#0b7fd4';

/**
 * A radius that grows with zoom.
 *
 * `min` at a whole-city view, `max` once you are down at street level, linear
 * in between. Written once because both station layers must scale together or
 * the halo detaches from its dot.
 */
function ZOOM_SCALED(min: number, max: number) {
  return ['interpolate', ['linear'], ['zoom'], 10, min, 16, max] as unknown as number;
}

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function lineFeature(coords: Array<[number, number]>) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: coords },
  };
}

function stationCollection(stations: MapStation[]) {
  return {
    type: 'FeatureCollection' as const,
    features: stations.map((s) => ({
      type: 'Feature' as const,
      properties: { id: s.id, name: s.name, bikes: s.bikes, docks: s.docks },
      geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
    })),
  };
}

export function RouteMap({ pickup, destination, geometry, stations = [], height = 232 }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const readyRef = useRef(false);
  const [hovered, setHovered] = useState<MapStation | null>(null);
  const [expanded, setExpanded] = useState(false);
  /**
   * Bumped every time a map instance finishes loading. Expanding portals the
   * container to <body>, which necessarily builds a new map — and the route
   * geometry and station dots then have to be re-applied to it. Without this,
   * an expanded map lost its road path and its stations, because the effects
   * that draw them saw unchanged data and did not re-run.
   */
  const [mapEpoch, setMapEpoch] = useState(0);

  const bounds = useCallback(
    (): [[number, number], [number, number]] => [
      [Math.min(pickup.lng, destination.lng), Math.min(pickup.lat, destination.lat)],
      [Math.max(pickup.lng, destination.lng), Math.max(pickup.lat, destination.lat)],
    ],
    [pickup, destination],
  );

  // Create the map once per route; geometry and stations are patched in later.
  useEffect(() => {
    let cancelled = false;
    const el = container.current;
    if (!el) return;

    void (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled || !container.current) return;

      const map = new maplibre.Map({
        container: el,
        style: basemap(),
        bounds: bounds(),
        fitBoundsOptions: { padding: MAP_FIT_PADDING, maxZoom: 14 },
        attributionControl: { compact: true },
        // The map is context; keyboard users tab straight past it.
        keyboard: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      mapRef.current = map as unknown as MapHandle;

      // MapLibre puts tabindex="0" on its canvas. The container is labelled
      // role="img", so a focusable child inside it is both a dead tab stop and
      // an accessibility violation — a screen reader announces one image and
      // then lands the user inside it with nothing to do. `keyboard: false`
      // already removed the handlers; this removes the stop.
      map.getCanvas().setAttribute('tabindex', '-1');

      // 'style.load' rather than 'load': it fires for the initial style and
      // again after a theme swap replaces it, which is exactly when the route
      // and station layers need putting back.
      map.on('style.load', () => {
        if (cancelled) return;
        if (map.getSource('route')) return;
        readyRef.current = true;
        setMapEpoch((n) => n + 1);
        map.addSource('route', {
          type: 'geojson',
          data: lineFeature([
            [pickup.lng, pickup.lat],
            [destination.lng, destination.lat],
          ]),
        });
        map.addSource('stations', { type: 'geojson', data: stationCollection([]) });

        // A casing under a coloured line, so the route reads on any basemap.
        // The casing is dark in dark mode and light in light mode — the same
        // relationship either way, which is why it is not a fixed white.
        map.addLayer({
          id: 'route-casing',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          // Colour comes from applyTone, so it is set in one place and follows
          // a live theme switch rather than being frozen at map creation.
          paint: { 'line-width': 8, 'line-opacity': 0.9 },
        });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            // The brand green, not near-black: on a light basemap a dark line
            // reads as a scribble over the streets rather than as the trip.
            'line-color': ROUTE_COLOR,
            'line-width': 3.6,
            'line-opacity': 0.98,
            'line-dasharray': [2, 1.7],
          },
        });

        // Station dots: colour carries meaning — a station with no bikes in it
        // is drawn hollow rather than hidden, because "empty" is information.
        map.addLayer({
          id: 'stations-halo',
          type: 'circle',
          source: 'stations',
          paint: {
            // Station dots are sized by zoom. At a whole-city view a fixed
            // radius turns sixty stations into one blue smear across midtown;
            // shrinking them keeps the density readable as density, and they
            // grow back to a tappable target as you zoom in.
            'circle-radius': ZOOM_SCALED(2.5, 12),
            'circle-color': STATION_COLOR,
            'circle-opacity': 0.14,
          },
        });
        map.addLayer({
          id: 'stations-dot',
          type: 'circle',
          source: 'stations',
          paint: {
            'circle-radius': ZOOM_SCALED(1.4, 6),
            'circle-color': ['case', ['>', ['get', 'bikes'], 0], STATION_COLOR, '#ffffff'],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 1.6],
            'circle-stroke-color': STATION_COLOR,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 14, 1],
          },
        });

        map.on('mouseenter', 'stations-dot', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { id: string; name: string; bikes: number; docks: number };
          const geom = f.geometry as unknown as { type: string; coordinates?: [number, number] };
          if (geom.type !== 'Point' || !geom.coordinates) return;
          const [lng, lat] = geom.coordinates;
          setHovered({ id: p.id, name: p.name, bikes: p.bikes, docks: p.docks, lng, lat });
        });
        map.on('mouseleave', 'stations-dot', () => {
          map.getCanvas().style.cursor = '';
          setHovered(null);
        });
        // Touch devices have no hover; a tap must reveal the same detail.
        map.on('click', 'stations-dot', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { id: string; name: string; bikes: number; docks: number };
          const geom = f.geometry as unknown as { type: string; coordinates?: [number, number] };
          if (geom.type !== 'Point' || !geom.coordinates) return;
          const [lng, lat] = geom.coordinates;
          setHovered({ id: p.id, name: p.name, bikes: p.bikes, docks: p.docks, lng, lat });
        });

        for (const [loc, kind] of [
          [pickup, 'pickup'],
          [destination, 'destination'],
        ] as const) {
          const dot = document.createElement('div');
          dot.setAttribute('aria-hidden', 'true');
          // Filled green at the start, hollow at the end: the same pair the
          // route line uses, so start and finish are distinguishable at a
          // glance without a legend.
          const isStart = kind === 'pickup';
          dot.style.cssText = [
            'width:14px',
            'height:14px',
            'border-radius:999px',
            `border:3px solid ${isStart ? '#ffffff' : ROUTE_COLOR}`,
            'box-shadow:0 1px 5px rgba(0,0,0,.4)',
            `background:${isStart ? ROUTE_COLOR : '#ffffff'}`,
          ].join(';');
          new maplibre.Marker({ element: dot }).setLngLat([loc.lng, loc.lat]).addTo(map);
        }

        // After the layers exist, so the casing is included.
        applyTone(map as unknown as MapHandle, prefersDark());
      });
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [pickup, destination, bounds, expanded]);

  // Swap the schematic line for the real road path once routing answers, and
  // draw it in so the eye follows the route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geometry) return;

    let raf = 0;
    const apply = () => {
      const source = map.getSource('route');
      if (!source) return false;

      const coords = geometry.coordinates;
      source.setData(lineFeature(coords));
      // Solid, not dashed: this line is a real path.
      map.setPaintProperty('route-line', 'line-dasharray', [1, 0]);

      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: MAP_FIT_PADDING, maxZoom: 14, duration: 500 },
      );

      // Reveal the path progressively. Cheap, brief, and skipped entirely for
      // anyone who has asked for reduced motion.
      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || coords.length < 8) return true;

      const started = performance.now();
      const DURATION = 620;
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / DURATION);
        const eased = 1 - Math.pow(1 - t, 3);
        const n = Math.max(2, Math.round(eased * coords.length));
        const s2 = map.getSource('route');
        if (s2) s2.setData(lineFeature(coords.slice(0, n)));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return true;
    };

    if (readyRef.current && apply()) return () => cancelAnimationFrame(raf);
    // Style may still be loading; retry briefly rather than dropping the path.
    const t = setInterval(() => {
      if (readyRef.current && apply()) clearInterval(t);
    }, 120);
    const stop = setTimeout(() => clearInterval(t), 4000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
      cancelAnimationFrame(raf);
    };
  }, [geometry, mapEpoch]);

  // Live station dots.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource('stations');
      if (!source) return false;
      source.setData(stationCollection(stations));
      return true;
    };
    if (readyRef.current && apply()) return;
    const t = setInterval(() => {
      if (readyRef.current && apply()) clearInterval(t);
    }, 150);
    const stop = setTimeout(() => clearInterval(t), 4000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [stations, mapEpoch]);

  // Follow the OS theme while the map is open. Retoning is a paint-property
  // change, so the route and stations stay exactly where they are — no style
  // reload, nothing to rebuild.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      const map = mapRef.current;
      if (map && readyRef.current) applyTone(map, e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  /**
   * Keep the canvas the size of its box.
   *
   * MapLibre sizes its drawing buffer once and does not watch the element, so
   * anything that changes the container has to tell it. This used to be a
   * single 220ms timeout after `expanded` flipped, and on a phone that lost the
   * race: the expanded map painted tiles across the top 250 pixels — exactly
   * the collapsed height — and left the rest black.
   *
   * A ResizeObserver is the right instrument. It fires whenever the box
   * actually changes, however it changed: expanding, collapsing, rotating the
   * device, the on-screen keyboard opening, or the rail scrollbar appearing.
   */
  useEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = { w: 0, h: 0 };
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      const map = mapRef.current;
      if (!box || !map) return;
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (w === last.w && h === last.h) return;
      last = { w, h };
      if (w === 0 || h === 0) return;
      map.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-frame the route when the panel opens or closes: a taller box should show
  // the whole trip, not the same crop at a different size.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => {
      map.resize();
      map.fitBounds(bounds(), { padding: MAP_FIT_PADDING, maxZoom: 14, duration: 320 });
    }, 260);
    return () => clearTimeout(t);
  }, [expanded, bounds]);

  const withBikes = stations.filter((s) => s.bikes > 0).length;

  const body = (
    <div
      style={
        expanded
          ? {
              position: 'fixed',
              inset: 'clamp(12px, 3vw, 40px)',
              zIndex: 79,
              display: 'flex',
              flexDirection: 'column',
            }
          : { position: 'relative' }
      }
    >
      <div
        ref={container}
        data-testid="route-map"
        className="rl-map-canvas"
        /*
         * `group`, not `img`. MapLibre injects its own controls into this
         * container — the attribution toggle is a real button, and attribution
         * is not optional — and a focusable child inside `role="img"` is both
         * an axe violation and a genuine trap: a screen reader announces one
         * image, then puts the user inside it. `group` carries the same label
         * and permits the controls to exist.
         */
        role="group"
        aria-label={`Map of the route from ${pickup.name} to ${destination.name}${
          stations.length > 0 ? `, with ${withBikes} bike stations that currently have bikes` : ''
        }`}
        style={{
          height: expanded ? '100%' : height,
          flex: expanded ? 1 : undefined,
          width: '100%',
          borderRadius: expanded ? 'var(--r-xl)' : 'var(--r-lg)',
          overflow: 'hidden',
          border: `1px solid ${expanded ? 'var(--border-emphasis)' : 'var(--border)'}`,
          background: 'var(--surface-sunken)',
          boxShadow: expanded ? 'var(--e-4)' : 'none',
          transition: expanded ? 'none' : 'height var(--d-slow) var(--ease-out)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--sp-1)',
        }}
      >
        <MapButton
          label={expanded ? 'Close the expanded map' : 'Expand the map'}
          onClick={() => setExpanded((v) => !v)}
          testId="map-expand"
        >
          {expanded ? '×' : '⤢'}
        </MapButton>
        <MapButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          +
        </MapButton>
        <MapButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          −
        </MapButton>
        <MapButton
          label="Recentre on the route"
          onClick={() =>
            mapRef.current?.fitBounds(bounds(), {
              padding: 'var(--sp-8)',
              maxZoom: 14,
              duration: 380,
            })
          }
        >
          ⌖
        </MapButton>
      </div>

      {/* The station tooltip takes this corner while it is open, so the legend
          steps aside rather than sitting under it. */}
      {stations.length > 0 && !hovered && (
        <div
          data-testid="map-station-legend"
          style={{
            // Top-left, not bottom-left: MapLibre's attribution sits along the
            // bottom edge and expands to full text on a narrow map, which put
            // "© OpenStreetMap contributors" straight through the legend.
            position: 'absolute',
            left: 8,
            top: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-15)',
            padding: '5px 9px',
            fontSize: 'var(--t-2xs)',
            fontWeight: 620,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--text-2)',
            background: 'color-mix(in srgb, var(--surface) 90%, transparent)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-full)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: 'var(--r-full)',
              background: '#0b7fd4',
              boxShadow: '0 0 0 3px rgb(11 127 212 / 0.18)',
            }}
          />
          {/* Compact on purpose: at 248px the long form took a third of the
              map's width to say something the dots already show. */}
          {withBikes}/{stations.length} with bikes
        </div>
      )}

      {hovered && (
        <div
          role="status"
          style={{
            position: 'absolute',
            left: 8,
            top: 8,
            maxWidth: 240,
            padding: '7px 10px',
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r-sm)',
            boxShadow: 'var(--e-2)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ display: 'block', fontSize: 'var(--t-sm)', fontWeight: 620 }}>
            {hovered.name}
          </span>
          <span className="tnum" style={{ fontSize: 'var(--t-xs)', color: 'var(--text-2)' }}>
            {hovered.bikes} bikes · {hovered.docks} docks free
          </span>
        </div>
      )}
    </div>
  );

  if (!expanded) return body;

  /**
   * Expanded, the map is portalled to <body>.
   *
   * The sticky rail it normally lives in creates a stacking context, which
   * traps a position:fixed child behind the result cards however high its
   * z-index — the reason an earlier "fullscreen" map rendered underneath them.
   * Portalling escapes that context. The map re-initialises on the way out and
   * back, and the browser serves the tiles it already holds.
   */
  if (typeof document === 'undefined') return body;
  return createPortal(
    <>
      <div
        className="scrim-in"
        onClick={() => setExpanded(false)}
        style={{ position: 'fixed', inset: 0, zIndex: 78, background: 'rgb(6 9 13 / 0.66)' }}
        aria-hidden
      />
      {body}
    </>,
    document.body,
  );
}

function MapButton({
  children,
  label,
  onClick,
  testId,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
      className="rl-press"
      style={{
        width: 28,
        height: 28,
        display: 'grid',
        placeItems: 'center',
        fontSize: 14,
        lineHeight: 1,
        color: 'var(--text-2)',
        background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--r-sm)',
        boxShadow: 'var(--e-1)',
        cursor: 'pointer',
        backdropFilter: 'blur(6px)',
      }}
    >
      {children}
    </button>
  );
}
