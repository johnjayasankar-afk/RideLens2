/**
 * Copy MapLibre's worker out of node_modules so it can be served from this
 * origin.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MapLibre v6 runs its tile decoder in a module worker and resolves the    │
 * │ URL with `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. The     │
 * │ bundler does not emit that as a served asset, so the request fell        │
 * │ through to the app's 404 page, the browser refused it for having a       │
 * │ text/html MIME type, and the map rendered a blank canvas with no pins.   │
 * │ v4 inlined the worker and had no such problem.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The worker also imports its shared chunk by relative path, so both files
 * have to land in the same directory.
 *
 * Copied at build time rather than committed. A vendored file nobody updates
 * is exactly the rot this project just spent a commit removing — this one is
 * regenerated from whatever version package.json resolves, so it cannot drift
 * from the module that loads it. public/vendor is gitignored.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"] as const;
const OUT = join(process.cwd(), "public", "vendor", "maplibre");

function main() {
  const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
  mkdirSync(OUT, { recursive: true });
  for (const f of FILES) {
    copyFileSync(join(dist, f), join(OUT, f));
  }
  const { version } = require("maplibre-gl/package.json") as { version: string };
  console.log(`vendored maplibre-gl ${version} worker -> public/vendor/maplibre/`);
}

main();
