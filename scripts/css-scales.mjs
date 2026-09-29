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
  /* Set at what the file measures after scripts/apply-scales.mjs ran, with no
     slack: 0.92em on <code>, the 30px mobile hero price, the map HUD's two
     absolute offsets, three rem insets and a handful of structural values the
     migration deliberately left alone. Every one is named in that script's
     output. There is no room here for a new stray, which is the point. */
  "font-size": 2,
  "border-radius": 1,
  /* Five after the multi-line fix below showed the line scanner had been
     counting three values that were not there. */
  padding: 5,
  gap: 1,
  /* Control heights. Fourteen distinct values were reachable on one screen —
     24, 26, 28, 30, 32, 34, 36, 38, 40, 44, 46, 48, 50, 52 — for pills that
     all do the same job. Four genuine layout minimums remain (a map canvas,
     an empty-state card); a fifth would be a control that missed the ladder. */
  "min-height": 6,
  /* Durations, however they are written: `transition`, `animation`, or the
     longhand. A motion system is a handful of speeds, not a hundred. */
  duration: 1,
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

/**
 * Declarations, not lines.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This scanned line by line, and prettier breaks any multi-value shorthand │
 * │ across lines. So every `transition:` with more than one property in it   │
 * │ was invisible to the check: `transition:` sat on one line and            │
 * │ `background-color 0.16s var(--ease),` on the next, and the value regex   │
 * │ never saw a value. The duration ladder reported "1 distinct" while the   │
 * │ file carried eight — 0.16s, 0.18s, 0.2s, 0.3s, 0.35s, 160ms — in the     │
 * │ hover transitions of the nav, the footer, .primary, .chip, .place-field, │
 * │ .prov-chip, .recent-trip-run and .ask-open. A guard that reads one line  │
 * │ of a declaration is a guard that passes on the declarations that matter  │
 * │ most, because the long ones are the ones prettier wraps.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the source is scanned whole and the line is recovered from the match
 * offset. `[^;{}]*` crosses newlines; `\s` in the prefix matches one too.
 */
const newlines = [];
for (let i = 0; i < clean.length; i += 1) if (clean[i] === "\n") newlines.push(i);
/** 0-based line index containing `offset`. */
const lineOf = (offset) => {
  let lo = 0;
  let hi = newlines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (newlines[mid] < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const found = {};
for (const prop of Object.keys(CEILINGS)) found[prop] = new Map();

{
  const line = clean;
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
      const at = lineOf(match.index);
      if (inTokens(at)) continue;
      const raw = match[1].trim();
      /* A whole declaration built from a calc() is reaching for the ladder,
         whatever bare numbers the expression contains — the reserve under the
         filter row is `calc(var(--ctl-md) + 2 * var(--s-2) + 2px)`, and the
         first version of this counted its `2` as a stray. */
      if (raw.includes("calc(")) continue;
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
        seen.push(at + 1);
        found[prop].set(value, seen);
      }
    }
  }
}

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
