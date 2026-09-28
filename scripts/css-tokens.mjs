/**
 * The tokens have to agree with each other.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Dark mode is written twice on purpose — once behind the OS media query   │
 * │ and once behind an explicit [data-theme="dark"], because an override the │
 * │ OS can overrule is not an override. Writing it twice means the two can   │
 * │ drift, and when they drift nothing complains: the combination that       │
 * │ breaks is the one nobody is looking at.                                  │
 * │                                                                          │
 * │ --scrim-rgb reached only the media block. OS-dark was fine; choosing     │
 * │ Dark on a light OS fell back to the light value. Six combinations, one   │
 * │ broken, and a screenshot of the wrong one says everything is well.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Three things are checked, all of them statically, all of them mistakes
 * that have actually shipped here:
 *
 *   1. The two dark blocks define the same properties, with the same values.
 *   2. Every var(--x) resolves to a property defined somewhere — in CSS, or
 *      set at runtime from JS. A name that resolves nowhere is frozen at its
 *      fallback forever (--porcelain, which kept a sheet light in dark mode)
 *      or invalidates its declaration outright.
 *   3. No property is defined in terms of itself. --btn-1: var(--btn-1) is
 *      what a careless find-and-replace leaves behind, and it silently
 *      removes the background from every button that reads it.
 *   4. No rule outside the palette hardcodes a colour the palette owns. The
 *      dashed line between From and To was `rgba(28, 51, 38, 0.2)` — a dark
 *      green dash, on the dark green card, invisible every night since it was
 *      written. The skeletons shimmered dark-on-dark for the same reason.
 *      Tokens only invert if they are used.
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const CSS = ["src/app/globals.css", "src/app/labs-glass.css"];
const JS_GLOBS = ["src/**/*.{ts,tsx,js,jsx}"];

/**
 * The two inks the palette flips between, as raw channels.
 *
 * Only these. White on the green button is white in both schemes and is not
 * a mistake; `rgba(15, 42, 29, …)` sits under elements that are dark green in
 * both. These two are the light ground's ink and the dark ground's ink, and
 * writing either one straight into a rule pins that rule to one scheme.
 */
const SCHEME_INKS = [
  { rgb: "28, 51, 38", of: "the light palette's forest ink" },
  { rgb: "190, 226, 205", of: "the dark palette's ash" },
];

/** Rules, flattened, each carrying the at-rules it sits inside. */
function parseRules(text) {
  /* Blank the comments but keep their newlines, or every line number after
     the first comment is wrong by the number of lines it spanned. */
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const rules = [];
  /* Each frame keeps its own body. A nested block must not swallow the
     declarations its parent wrote before it — that is how an entire :root
     went missing the first time this script ran. */
  const stack = [{ prelude: "", line: 1, body: "" }];
  let pending = "";
  let line = 1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\n") line++;
    if (ch === "{") {
      stack.push({ prelude: pending.trim(), line, body: "" });
      pending = "";
    } else if (ch === "}") {
      const frame = stack.pop();
      if (frame && !frame.prelude.startsWith("@")) {
        rules.push({
          selector: frame.prelude,
          body: frame.body,
          line: frame.line,
          at: stack.slice(1).map((f) => f.prelude),
        });
      }
      pending = "";
    } else if (ch === ";") {
      /* A selector never contains a semicolon. Without this the `@import` at
         the top of the file stayed glued to the first :root, which then read
         as an at-rule and was skipped — taking every space and radius token
         with it. */
      pending = "";
      stack[stack.length - 1].body += ch;
    } else {
      pending += ch;
      stack[stack.length - 1].body += ch;
    }
  }
  return rules;
}

/**
 * Blank out every `var(--x, …)` fallback, keeping the rest of the text.
 *
 * A regex cannot do this: the fallbacks here contain nested parentheses —
 * rgba(), blur(), whole box-shadow lists — and `[^)]*` stops at the first of
 * them. This walks the parens instead.
 */
function stripFallbacks(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const m = /^var\(\s*--[A-Za-z0-9_-]+\s*,/.exec(text.slice(i));
    if (!m) {
      out += text[i];
      continue;
    }
    let depth = 1;
    let j = i + m[0].length;
    while (j < text.length && depth > 0) {
      if (text[j] === "(") depth++;
      else if (text[j] === ")") depth--;
      j++;
    }
    out += m[0];
    i = j - 1;
  }
  return out;
}

/* Two blocks saying the same thing may be indented differently — one of them
   is nested in a media query, and the formatter knows it. */
const normalize = (v) => v.replace(/\s+/g, " ").trim();

function declarations(body, startLine) {
  const out = [];
  let offset = 0;
  for (const part of body.split(";")) {
    const m = part.match(/^\s*(--[A-Za-z0-9_-]+)\s*:([\s\S]*)$/);
    if (m) {
      /* The line the property itself is on, not the line its block opens on —
         a token file is long and ":5" is not a useful place to look. */
      const lead = part.slice(0, part.indexOf(m[1]));
      const line = startLine + (body.slice(0, offset) + lead).split("\n").length - 1;
      out.push([m[1], m[2].trim(), line]);
    }
    offset += part.length + 1;
  }
  return out;
}

const problems = [];
const definedEverywhere = new Set();
const usages = [];

for (const file of CSS) {
  const text = readFileSync(file, "utf8");
  const rules = parseRules(text);

  /* The two ways this codebase says "dark". */
  const viaMedia = new Map();
  const viaAttr = new Map();

  for (const rule of rules) {
    const inDarkMedia = rule.at.some((a) => /prefers-color-scheme:\s*dark/.test(a));
    const rootish = /(^|,)\s*:root/.test(rule.selector);
    const attrDark = /\[data-theme=["']?dark["']?\]/.test(rule.selector);

    for (const [prop, value, declLine] of declarations(rule.body, rule.line)) {
      definedEverywhere.add(prop);

      /* 3. A property written in terms of itself. */
      const selfRef = new RegExp(`var\\(\\s*${prop}(?![\\w-])`).test(value);
      if (selfRef) {
        problems.push({
          file,
          line: declLine,
          kind: "self-reference",
          detail: `${prop} is defined as itself — ${prop}: ${value.slice(0, 48)}`,
        });
      }

      if (inDarkMedia && rootish) viaMedia.set(prop, value);
      else if (!inDarkMedia && attrDark && rootish) viaAttr.set(prop, value);
    }

    /* 4. A palette colour written into a rule instead of read from a token.
       Custom-property declarations are where these belong and are skipped, as
       are var() fallbacks — a fallback only applies when its token is unset,
       and the scheme blocks are exactly what set it. labs-glass.css writes its
       light rim that way on purpose. */
    const ordinary = stripFallbacks(rule.body.replace(/--[A-Za-z0-9_-]+\s*:[^;]*/g, ""));
    for (const ink of SCHEME_INKS) {
      const at = ordinary.indexOf(`rgba(${ink.rgb}`);
      if (at === -1) continue;
      problems.push({
        file,
        line: rule.line,
        kind: "pinned colour",
        detail:
          `${rule.selector.slice(0, 44)} hardcodes ${ink.of} — rgba(${ink.rgb}, …).\n` +
          `                   It will not invert. Use the token that already holds it.`,
      });
    }
  }

  /* 1. The two dark blocks have to say the same thing. */
  if (viaMedia.size || viaAttr.size) {
    for (const [prop, value] of viaMedia) {
      if (!viaAttr.has(prop)) {
        problems.push({
          file,
          kind: "dark drift",
          detail: `${prop} is set for OS dark but not for a chosen Dark — picking Dark on a light OS gets the light value`,
        });
      } else if (normalize(viaAttr.get(prop)) !== normalize(value)) {
        problems.push({
          file,
          kind: "dark drift",
          detail:
            `${prop} differs between the two dark blocks:\n` +
            `                   OS dark:     ${normalize(value)}\n` +
            `                   chosen Dark: ${normalize(viaAttr.get(prop))}`,
        });
      }
    }
    for (const prop of viaAttr.keys()) {
      if (!viaMedia.has(prop)) {
        problems.push({
          file,
          kind: "dark drift",
          detail: `${prop} is set for a chosen Dark but not for OS dark — a dark OS with no choice made gets the light value`,
        });
      }
    }
  }

  for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)) {
    usages.push({ file, prop: m[1], hasFallback: Boolean(m[2]), index: m.index });
  }
}

/* Properties handed to the page at runtime are defined too, just not here. */
const setFromJs = new Set();
for (const pattern of JS_GLOBS) {
  for (const file of globSync(pattern)) {
    const text = readFileSync(file, "utf8");
    /* Any spelling counts. The code sets these through setProperty, through
       a vars object a loop hands to setProperty, and through an inline
       style="--pin:#1f6b4a" inside a template literal. The question here is
       only whether a producer exists at all. */
    for (const m of text.matchAll(/--[A-Za-z0-9_-]+/g)) {
      setFromJs.add(m[0]);
    }
  }
}

/* 2. Names that resolve to nothing at all. */
const reportedMissing = new Set();
for (const use of usages) {
  if (definedEverywhere.has(use.prop) || setFromJs.has(use.prop)) continue;
  if (reportedMissing.has(use.prop)) continue;
  reportedMissing.add(use.prop);
  problems.push({
    file: use.file,
    kind: "undefined token",
    detail: use.hasFallback
      ? `${use.prop} is never defined, so its fallback is the only value it will ever have`
      : `${use.prop} is never defined and has no fallback, so the declaration is invalid`,
  });
}

if (problems.length === 0) {
  console.log(
    `CSS tokens: ${definedEverywhere.size} defined, ${new Set(usages.map((u) => u.prop)).size} referenced — both dark blocks agree.`,
  );
  process.exit(0);
}

console.log(`\n${problems.length} token problem${problems.length === 1 ? "" : "s"}\n`);
for (const p of problems) {
  const where = p.line ? `${p.file}:${p.line}` : p.file;
  console.log(`  ${p.kind.padEnd(16)} ${where}`);
  console.log(`  ${" ".repeat(16)} ${p.detail}\n`);
}
process.exit(1);
