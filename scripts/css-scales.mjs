/**
 * A design system is a short list of numbers used everywhere.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Before this existed, globals.css held 21 distinct font sizes — 10, 10.5, │
 * │ 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 17, 19, 24, 26,    │
 * │ 28, 30, 34 — 13 border radii, 18 padding values and 17 gaps. Every one   │
 * │ was chosen reasonably, one surface at a time, by somebody looking at     │
 * │ that surface. None of them was wrong. Together they are the difference   │
 * │ between an interface that feels designed and one that feels assembled,   │
 * │ and no review catches it because no single line is the problem.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So this counts. It is the only check in the repo that cares about a number's
 * *company* rather than a number. Declarations inside the token blocks are the
 * scale itself and are exempt — that is where a new value is supposed to be
 * added, deliberately, with the rest of the ladder visible around it.
 *
 * `node scripts/css-scales.mjs` prints the ladders and fails when one grows
 * past its ceiling. Raising a ceiling is a decision; make it in the commit
 * message, the way the bundle budget is raised.
 */

import { readFileSync } from "node:fs";

const FILE = "src/app/globals.css";

/**
 * How many distinct literal values each property may carry outside the tokens.
 *
 * Set at what the stylesheet measures today, not at an aspiration: a ceiling
 * nobody is under is a ceiling nobody reads. Tighten by lowering these after
 * a cleanup, never by exempting a rule.
 */
const CEILINGS = {
  "font-size": 8,
  "border-radius": 6,
  padding: 10,
  gap: 8,
  /* Durations, however they are written: `transition`, `animation`, or the
     longhand. A motion system is a handful of speeds, not a hundred. */
  duration: 6,
};

/** Values that are structural rather than scale choices. */
const EXEMPT = new Set([
  "0",
  "0px",
  "1px", // a hairline is not a spacing decision
  "50%",
  "100%",
  "999px", // the pill
  "inherit",
  "auto",
  "none",
]);

const source = readFileSync(FILE, "utf8");

/**
 * The token blocks, by line range.
 *
 * Everything inside `:root` or a `:root[...]`/dark block is the ladder being
 * defined. A value there is the point; a value outside it is a value somebody
 * typed instead of reaching for the ladder.
 */
function tokenRanges(text) {
  const lines = text.split("\n");
  const ranges = [];
  let depth = 0;
  let start = -1;
  lines.forEach((line, i) => {
    if (start === -1 && /^\s*(:root|@media[^{]*\{?\s*$)/.test(line) && /:root/.test(line)) {
      start = i;
      depth = 0;
    }
    if (start !== -1) {
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      if (depth <= 0 && i > start) {
        ranges.push([start, i]);
        start = -1;
      }
    }
  });
  return ranges;
}

const ranges = tokenRanges(source);
const inTokens = (line) => ranges.some(([a, b]) => line >= a && line <= b);

/** Strip comments, keeping line numbers, so a value in prose is not counted. */
const clean = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
const lines = clean.split("\n");

const found = {};
for (const prop of Object.keys(CEILINGS)) found[prop] = new Map();

lines.forEach((line, i) => {
  if (inTokens(i)) return;
  for (const prop of Object.keys(CEILINGS)) {
    /*
     * `padding` matches padding-left too, which is the same decision. The
     * `duration` pseudo-property is special: durations are almost never
     * written as transition-duration here, they are the first time value in a
     * `transition` or `animation` shorthand, so it reads those instead.
     */
    const re =
      prop === "duration"
        ? /(?:^|[;{\s])(?:transition|animation)(?:-duration)?\s*:([^;{}]+)/g
        : new RegExp(`(?:^|[;{\\s])${prop}(?:-[a-z]+)?\\s*:([^;{}]+)`, "g");
    for (const match of line.matchAll(re)) {
      const raw = match[1].trim();
      /* A var() reference IS reaching for the ladder. A shorthand of several
         values contributes each of them. */
      for (const value of raw.replace(/,/g, " ").split(/\s+/)) {
        if (!value || value.startsWith("var(") || value.includes("calc(")) continue;
        if (EXEMPT.has(value)) continue;
        /* A duration is the only kind of time value; anything unitless in a
           shorthand is an iteration count or a cubic-bezier fragment. */
        if (prop === "duration") {
          if (!/^[\d.]+m?s$/.test(value)) continue;
        } else if (!/^-?[\d.]+(px|rem|em|%)?$/.test(value)) continue;
        const seen = found[prop].get(value) ?? [];
        seen.push(i + 1);
        found[prop].set(value, seen);
      }
    }
  }
});

let over = 0;
console.log(`\nCSS scales in ${FILE} (values outside the token blocks)\n`);

for (const [prop, ceiling] of Object.entries(CEILINGS)) {
  const ladder = [...found[prop].entries()].sort(
    (a, b) => parseFloat(a[0]) - parseFloat(b[0]) || a[0].localeCompare(b[0]),
  );
  const bad = ladder.length > ceiling;
  if (bad) over += 1;
  console.log(
    `  ${bad ? "OVER " : "ok   "} ${prop.padEnd(20)} ${String(ladder.length).padStart(3)} distinct / ${ceiling}`,
  );
  console.log(`        ${ladder.map(([v, at]) => `${v}×${at.length}`).join("  ") || "(none)"}`);
  if (bad) {
    /* The rarest values are the ones that drifted in; name where they are. */
    const strays = ladder.sort((a, b) => a[1].length - b[1].length).slice(0, 6);
    console.log(
      `        strays: ${strays.map(([v, at]) => `${v} at ${FILE}:${at.slice(0, 3).join(",")}`).join(" | ")}`,
    );
  }
  console.log("");
}

if (over > 0) {
  console.error(
    `${over} ladder${over === 1 ? "" : "s"} past its ceiling. Reach for the scale, or raise the\n` +
      `ceiling in scripts/css-scales.mjs and say why in the commit message.\n`,
  );
  process.exit(1);
}
console.log("Every ladder is inside its ceiling.\n");
