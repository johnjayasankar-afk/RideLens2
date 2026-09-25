/**
 * MapLibre and its stylesheet, in one lazily-imported module.
 *
 * The stylesheet has to be imported *here* rather than in route-map.tsx.
 * A top-level `import "maplibre-gl/dist/maplibre-gl.css"` in a client
 * component is hoisted into the route's own stylesheet, which took the CSS
 * budget from 12 KB to 33 KB and shipped the map's styles to every page —
 * including the ones that never render a map. Attached to this module, it
 * travels with the chunk that only loads when a map does.
 */
import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";

/*
 * Point MapLibre at the worker this origin serves.
 *
 * v6 decodes tiles in a module worker and resolves its URL relative to its
 * own module. The bundler does not emit that as an asset, so the request hit
 * the app's 404 page, the browser refused a script served as text/html, and
 * the map drew an empty canvas. scripts/vendor-map-worker.ts copies the
 * worker (and the shared chunk it imports by relative path) out of
 * node_modules on every build, so this URL always matches the installed
 * version.
 */
maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");

export * from "maplibre-gl";
