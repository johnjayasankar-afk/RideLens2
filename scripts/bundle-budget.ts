/**
 * Fail the build when the page gets heavier than we decided it may be.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A budget nobody enforces is a preference. This runs in `npm run verify`  │
 * │ and exits non-zero, so the conversation about a heavier page happens at  │
 * │ the moment somebody makes it heavier, rather than six months later when  │
 * │ the cause is unrecoverable.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Measures gzipped bytes, because that is what crosses the network. Raw size
 * is what a bundler reports and is not what anyone waits for.
 *
 * MapLibre gets its own line rather than being folded into `clientJs`. It is
 * lazily imported, so it costs nothing until a map renders — but at more than
 * the rest of the app combined it is not something to leave unmeasured
 * either. Two honest numbers beat one that needs a footnote.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

/**
 * Gzipped kilobytes. Raise one of these only with a reason worth writing in
 * the commit message — each is roughly 15% above what the page measured when
 * the budget was set, which is room to work rather than room to drift.
 */
const BUDGETS_KB = {
  /** Everything the browser must execute before the page is interactive. */
  clientJs: 200,
  /** One stylesheet, and it should stay one. */
  css: 20,
  /** Self-hosted, subset, and the largest single category after JS. */
  fonts: 95,
  /**
   * MapLibre and its stylesheet, fetched only when a map is rendered.
   *
   * Generous because it is one upstream package and we do not control its
   * size: v4 was 207 KB and the v6 required to clear a critical XSS advisory
   * is larger. The ceiling exists to catch it being pulled into the initial
   * bundle by accident, or doubling again.
   */
  lazyMap: 320,
} as const;

const NEXT_DIR = ".next";

function gzipKb(paths: readonly string[]): number {
  let total = 0;
  for (const p of paths) {
    try {
      total += gzipSync(readFileSync(p)).length;
    } catch {
      // A file in the manifest that is not on disk is a build problem, not a
      // budget problem — let the build itself report it.
    }
  }
  return total / 1024;
}

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, match));
    else if (match.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * The stylesheets the root page actually loads.
 *
 * Summing every .css under static/ counted the lazily-imported map styles
 * against the page, which reported 33 KB for a page that downloads 12. The
 * RSC manifest lists what a page pulls on arrival, which is the number worth
 * having a ceiling on.
 */
function initialCss(): string[] {
  const manifestPath = join(NEXT_DIR, "server/app/page_client-reference-manifest.js");
  let src: string;
  try {
    src = readFileSync(manifestPath, "utf8");
  } catch {
    // Fall back to everything rather than silently reporting zero.
    return walk(join(NEXT_DIR, "static"), /\.css$/);
  }
  const refs = new Set(src.match(/static\/(?:chunks|media)\/[A-Za-z0-9_.-]+\.css/g) ?? []);
  return [...refs].map((f) => join(NEXT_DIR, f));
}

/** Whatever chunk MapLibre ended up in, found by looking inside rather than by name. */
function mapChunks(): string[] {
  const candidates = [
    ...walk(join(NEXT_DIR, "static"), /\.js$/),
    ...walk(join(NEXT_DIR, "static"), /maplibre.*\.css$/),
  ];
  return candidates.filter((f) => {
    if (f.endsWith(".css")) return true;
    try {
      return readFileSync(f, "utf8").includes("maplibregl-canvas");
    } catch {
      return false;
    }
  });
}

function main() {
  try {
    statSync(NEXT_DIR);
  } catch {
    console.error("No .next directory. Run `next build` first.");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(join(NEXT_DIR, "build-manifest.json"), "utf8")) as {
    rootMainFiles?: string[];
    polyfillFiles?: string[];
  };

  const jsFiles = [...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])].map((f) =>
    join(NEXT_DIR, f),
  );
  const fontFiles = walk(join(NEXT_DIR, "static"), /\.(woff2?|ttf|otf)$/);

  const measured = {
    clientJs: gzipKb(jsFiles),
    css: gzipKb(initialCss()),
    fonts: gzipKb(fontFiles),
    lazyMap: gzipKb(mapChunks()),
  };

  let failed = false;
  console.log("Bundle budget (gzipped)\n");
  for (const [key, budget] of Object.entries(BUDGETS_KB) as Array<
    [keyof typeof BUDGETS_KB, number]
  >) {
    const kb = measured[key];
    const over = kb > budget;
    if (over) failed = true;
    const pct = Math.round((kb / budget) * 100);
    console.log(
      `  ${over ? "OVER " : "ok   "} ${key.padEnd(9)} ${kb.toFixed(1).padStart(7)} KB / ${String(budget).padStart(4)} KB  (${pct}%)`,
    );
  }

  if (failed) {
    console.error(
      "\nOver budget. Either make it smaller, or raise the budget in" +
        " scripts/bundle-budget.ts and say why in the commit message.",
    );
    process.exit(1);
  }
  console.log("\nWithin budget.");
}

main();
