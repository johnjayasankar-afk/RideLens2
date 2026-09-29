/**
 * Snap globals.css onto the ladders, once.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This is a migration, not a check — `scripts/css-scales.mjs` is the check │
 * │ that keeps it true afterwards. It exists as a script rather than as an   │
 * │ afternoon of hand edits because there are roughly 600 literals to move   │
 * │ across 4,950 lines, and the failure mode of doing that by hand is not    │
 * │ "it looks wrong", it is "one of them is 13px and nobody will ever find   │
 * │ out which".                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Each literal is mapped to the NEAREST rung of its ladder. The rungs were
 * chosen from the actual distribution — 13px appeared 41 times and 12.5px 21,
 * so the ladder has a rung at each rather than splitting the difference and
 * moving both. Nothing here should move by more than a pixel or two, and the
 * point is not the pixels: it is that afterwards there are nine type sizes
 * instead of eighteen, and the next person reaches for one of the nine.
 *
 * Run it twice and the second run is a no-op — everything is already a var().
 *
 *   node scripts/apply-scales.mjs          # report only
 *   node scripts/apply-scales.mjs --write  # rewrite the file
 */

import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/app/globals.css";
const WRITE = process.argv.includes("--write");

/**
 * The ladders.
 *
 * `px` is the rung's value, `name` the token. Order does not matter; the
 * nearest rung wins, and a tie goes to the larger one because shrinking text
 * is the change a reader notices.
 */
const LADDERS = {
  "font-size": [
    ["--t-1", 10.5],
    ["--t-2", 11.5],
    ["--t-3", 12.5],
    ["--t-4", 13.5],
    ["--t-5", 15],
    ["--t-6", 16],
    ["--t-7", 19],
    ["--t-8", 26],
    ["--t-9", 34],
  ],
  "border-radius": [
    ["--r-1", 4],
    ["--r-2", 8],
    ["--r-3", 12],
    ["--r-4", 16],
    ["--r-5", 22],
  ],
  space: [
    ["--s-1", 2],
    ["--s-2", 4],
    ["--s-3", 6],
    ["--s-4", 8],
    ["--s-5", 12],
    ["--s-6", 16],
    ["--s-7", 20],
    ["--s-8", 24],
    ["--s-9", 32],
    ["--s-10", 40],
    ["--s-11", 48],
  ],
  "min-height": [
    ["--ctl-xs", 26],
    ["--ctl-sm", 32],
    ["--ctl-md", 36],
    ["--ctl-lg", 40],
    ["--ctl-xl", 44],
    ["--ctl-2xl", 52],
  ],
  duration: [
    ["--dur-1", 120],
    ["--dur-2", 200],
    ["--dur-3", 320],
    ["--dur-4", 520],
    ["--dur-5", 1100],
    ["--dur-6", 2400],
  ],
};

/**
 * Values that are structural rather than choices from a ladder.
 *
 * A hairline is one device pixel and has no business being rounded to the
 * spacing scale. A pill's radius is "half of whatever this is". Zero is zero.
 */
const KEEP = new Set(["0", "0px", "1px", "50%", "100%", "999px", "auto", "inherit", "none"]);

/**
 * How far a literal may be moved before it counts as an outlier rather than
 * drift.
 *
 * Without this the map is blind: 114px of map-HUD offset and 83px of hero
 * inset are nearest to the largest rung on the spacing ladder and would have
 * been snapped there, and the 30px mobile hero price — which exists precisely
 * to be smaller than the 34px desktop one — would have been snapped back up to
 * 34 and quietly deleted the override.
 *
 * Small values get an absolute tolerance because a ratio is meaningless at 3px.
 * Type gets a tight one because a deliberate step is usually small.
 */
function tolerance(kind, value) {
  if (kind === "font-size") return Math.max(1, value * 0.1);
  if (kind === "duration") return value * 0.45;
  return value <= 8 ? 2 : value * 0.2;
}

/**
 * Properties whose values come off the spacing ladder.
 *
 * Margins are deliberately absent: several are negative overlaps tuned against
 * a specific neighbour (the hero drawer's -3px seam, the refresh bar's offset)
 * and snapping those to a grid moves things that were measured.
 */
const SPACE_PROPS = /^(padding|padding-(top|right|bottom|left)|gap|row-gap|column-gap)$/;

function nearest(ladder, value) {
  let best = null;
  let bestGap = Infinity;
  for (const [name, px] of ladder) {
    const gap = Math.abs(px - value);
    if (gap < bestGap || (gap === bestGap && px > value)) {
      best = name;
      bestGap = gap;
    }
  }
  return { name: best, gap: bestGap };
}

const source = readFileSync(FILE, "utf8");
const lines = source.split("\n");

/* The token blocks define the ladders; their own values stay literal. */
function tokenLines(text) {
  const out = new Set();
  const ls = text.split("\n");
  let depth = 0;
  let inside = false;
  ls.forEach((line, i) => {
    if (!inside && /:root/.test(line) && line.includes("{")) {
      inside = true;
      depth = 0;
    }
    if (inside) {
      out.add(i);
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      if (depth <= 0) inside = false;
    }
  });
  return out;
}
const skip = tokenLines(source);

/* Comments blanked, newlines kept, so a value in prose is never rewritten. */
const masked = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).split("\n");

const moved = [];
const kept = [];
const out = lines.slice();

lines.forEach((line, i) => {
  if (skip.has(i)) return;
  const m = masked[i];
  if (!m.includes(":")) return;

  let next = line;

  /* font-size, including the `font:` shorthand's size/line-height slot. */
  next = next.replace(/(font-size:\s*)(-?[\d.]+)px/g, (all, head, num) => {
    const value = parseFloat(num);
    const { name, gap } = nearest(LADDERS["font-size"], value);
    if (gap > tolerance("font-size", value)) {
      kept.push({ line: i + 1, prop: "font-size", value: `${num}px`, gap });
      return all;
    }
    moved.push({ line: i + 1, prop: "font-size", from: `${num}px`, to: name, gap });
    return `${head}var(${name})`;
  });
  next = next.replace(/(font:\s*[^;]*?\s)(-?[\d.]+)px(\/)/g, (all, head, num, slash) => {
    const value = parseFloat(num);
    const { name, gap } = nearest(LADDERS["font-size"], value);
    if (gap > tolerance("font-size", value)) {
      kept.push({ line: i + 1, prop: "font(shorthand)", value: `${num}px`, gap });
      return all;
    }
    moved.push({ line: i + 1, prop: "font(shorthand)", from: `${num}px`, to: name, gap });
    return `${head}var(${name})${slash}`;
  });

  next = next.replace(/(min-height:\s*)(-?[\d.]+)px/g, (all, head, num) => {
    const value = parseFloat(num);
    const { name, gap } = nearest(LADDERS["min-height"], value);
    if (gap > tolerance("min-height", value)) {
      kept.push({ line: i + 1, prop: "min-height", value: `${num}px`, gap });
      return all;
    }
    moved.push({ line: i + 1, prop: "min-height", from: `${num}px`, to: name, gap });
    return `${head}var(${name})`;
  });

  next = next.replace(/(border-radius:\s*)([^;]+)/g, (all, head, rest) => {
    if (rest.includes("var(")) return all;
    const parts = rest.trim().split(/\s+/);
    const mapped = parts.map((p) => {
      if (KEEP.has(p) || !/^-?[\d.]+px$/.test(p)) return p;
      const value = parseFloat(p);
      const { name, gap } = nearest(LADDERS["border-radius"], value);
      if (gap > tolerance("border-radius", value)) {
        kept.push({ line: i + 1, prop: "border-radius", value: p, gap });
        return p;
      }
      moved.push({ line: i + 1, prop: "border-radius", from: p, to: name, gap });
      return `var(${name})`;
    });
    return `${head}${mapped.join(" ")}`;
  });

  next = next.replace(/(^|[;{\s])([a-z-]+):\s*([^;{}]+)/g, (all, lead, prop, rest) => {
    if (!SPACE_PROPS.test(prop)) return all;
    if (rest.includes("var(") || rest.includes("calc(") || rest.includes("env(")) return all;
    const parts = rest.trim().split(/\s+/);
    const mapped = parts.map((p) => {
      if (KEEP.has(p) || !/^[\d.]+px$/.test(p)) return p;
      const value = parseFloat(p);
      const { name, gap } = nearest(LADDERS.space, value);
      if (gap > tolerance("space", value)) {
        kept.push({ line: i + 1, prop, value: p, gap });
        return p;
      }
      moved.push({ line: i + 1, prop, from: p, to: name, gap });
      return `var(${name})`;
    });
    return `${lead}${prop}: ${mapped.join(" ")}`;
  });

  /* Durations, wherever they are written. */
  next = next.replace(
    /(^|[;{\s])(transition|animation)(-duration)?:\s*([^;{}]+)/g,
    (all, lead, prop, sub, rest) => {
      if (rest.includes("var(--dur")) return all;
      const mapped = rest.replace(/(?<![\w-])([\d.]+)(m?s)(?![\w-])/g, (t, num, unit) => {
        const ms = unit === "s" ? parseFloat(num) * 1000 : parseFloat(num);
        const { name, gap } = nearest(LADDERS.duration, ms);
        /* A value far from every rung is a deliberate outlier, not drift. */
        if (gap > tolerance("duration", ms)) {
          kept.push({ line: i + 1, prop, value: t, gap });
          return t;
        }
        moved.push({ line: i + 1, prop: `${prop}${sub ?? ""}`, from: t, to: name, gap });
        return `var(${name})`;
      });
      return `${lead}${prop}${sub ?? ""}: ${mapped}`;
    },
  );

  out[i] = next;
});

const byProp = {};
for (const m of moved) byProp[m.prop] = (byProp[m.prop] ?? 0) + 1;
const drift = moved.filter((m) => m.gap >= 2);

console.log(`\n${moved.length} literals mapped onto the ladders\n`);
for (const [prop, n] of Object.entries(byProp).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${prop}`);
}
console.log(`\n  ${kept.length} left alone as outliers, not drift:`);
for (const k of kept) {
  console.log(`    ${FILE}:${k.line}  ${k.prop}: ${k.value}  (nearest rung is ${k.gap} away)`);
}
console.log(`\n  ${drift.length} moved by 2 or more:`);
for (const d of drift.slice(0, 24)) {
  console.log(`    ${FILE}:${d.line}  ${d.prop}: ${d.from} -> ${d.to}  (${d.gap})`);
}
if (drift.length > 24) console.log(`    ... and ${drift.length - 24} more`);

if (WRITE) {
  writeFileSync(FILE, out.join("\n"));
  console.log(`\nWrote ${FILE}.\n`);
} else {
  console.log(`\nDry run. Pass --write to apply.\n`);
}
