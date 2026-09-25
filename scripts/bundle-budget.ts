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
 * Deliberately does NOT measure MapLibre, which is loaded from a CDN at
 * runtime and is 207 KB gzipped on its own — larger than everything here put
 * together. That is recorded in docs/PERFORMANCE.md rather than smuggled into
 * a number that would then need a footnote every time it was quoted.
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
  const cssFiles = walk(join(NEXT_DIR, "static"), /\.css$/);
  const fontFiles = walk(join(NEXT_DIR, "static"), /\.(woff2?|ttf|otf)$/);

  const measured = {
    clientJs: gzipKb(jsFiles),
    css: gzipKb(cssFiles),
    fonts: gzipKb(fontFiles),
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
