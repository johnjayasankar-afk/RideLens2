/**
 * The contrast audit walks text nodes, so it has never seen a chart.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Every one of the five standing guards passed on a Breakdown bar whose    │
 * │ ride slice measured 1.01:1 against its fees slice: the panel whose whole │
 * │ job is showing where the money goes was a single-tone bar, and nothing   │
 * │ could tell. `contrast-audit.mjs` only measures a colour against the      │
 * │ surface behind it, and only for elements carrying text — so a stacked    │
 * │ bar, a track and its fill, a ramp, a split: all invisible to it.         │
 * │                                                                          │
 * │ WCAG 2.2 SC 1.4.11 asks 3:1 for the parts of a graphic you need in order │
 * │ to understand it, measured against the ADJACENT colour. That is the      │
 * │ measurement this makes, and it is the one nothing else here makes.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `node scripts/fill-audit.mjs [url]` against a running build.
 *
 * Two kinds of pair are measured.
 *
 *   ADJACENT   two element siblings that both carry a fill, carry no text of
 *              their own, are at least 6px in both directions, and whose
 *              boxes actually touch — the segments of a stacked bar.
 *   IN TRACK   a fill inside a larger fill it does not cover: a band in its
 *              ruler, a step in its rail. A bar whose end you cannot find is
 *              a bar with no length, which is the whole of what it says.
 *
 * A pair with a visible rule between them — a border, an outline, a ring
 * drawn as an inset shadow, or, for two siblings, simply a gap showing the
 * track behind — is separated by that rule and is not reported, because a
 * reader can see where one ends. The ring has to be on the inner element: a
 * ring around a track says nothing about where the bar inside it stops.
 */
import { readFileSync } from "node:fs";

import { chromium } from "@playwright/test";

const URL =
  process.argv[2] ??
  "http://localhost:3000/?from=40.7549,-73.9840,A&to=40.6413,-73.7781,B&filter=ALL";
const ORIGIN = URL.slice(0, URL.indexOf("/", URL.indexOf("//") + 2));

/** The floor. SC 1.4.11's number, which is the number a chart is held to. */
const NEED = 3;

/**
 * Pairs allowed below the floor, each with the reason it is legible anyway.
 *
 * A list, not a threshold: an exemption that has to be named is an exemption
 * somebody has looked at. Raising the count is a decision; make it in the
 * commit message.
 */
const ALLOWED = [
  /*
   * Empty, and that is the point.
   *
   * The first version of this list exempted anything whose class ended in
   * -track, meaning to let an unfilled remainder read as unfilled — and it
   * matched `axis-bar | axis-track`, which is a band against its ruler at
   * 2.13:1, the exact thing this file exists to find. An exemption written
   * as a pattern exempts what it matches, not what it meant. If one is ever
   * needed, write the pair out and say why it reads anyway.
   */
];

const MODEL_VERSION = (readFileSync("src/lib/sources/ratecard/model-params.ts", "utf8").match(
  /MODEL_VERSION\s*=\s*"([^"]+)"/,
) ?? [])[1];

const SEED_TRIPS = Array.from({ length: 4 }, (_, i) => ({
  v: 1,
  id: `fill-${i}`,
  at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
  from: { lat: 40.7549, lng: -73.984, label: "Midtown" },
  to: { lat: 40.6413, lng: -73.7781, label: "JFK Airport" },
  routeKey: "40.755,-73.984>40.641,-73.778",
  miles: 17.4,
  minutes: 38,
  quotes: [
    {
      provider: "uber",
      product: "UberX",
      lowMinor: 4200 + i * 600,
      highMinor: 4800 + i * 600,
      type: "ESTIMATE_RANGE",
      confidence: "MEDIUM",
    },
  ],
  modelVersion: MODEL_VERSION,
}));

const AUDIT = () => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  };
  const firstStop = (bi) => {
    if (!bi || bi === "none") return null;
    for (const m of bi.matchAll(/rgba?\([^)]+\)/g)) {
      const c = parse(m[0]);
      if (c && c.a > 0.5) return c;
    }
    return null;
  };
  /* What is behind this element, for compositing a translucent fill. */
  const behind = (el) => {
    let e = el.parentElement;
    while (e) {
      const cs = getComputedStyle(e);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0.95) return c.rgb;
      const g = firstStop(cs.backgroundImage);
      if (g && g.a > 0.95) return g.rgb;
      e = e.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor)?.rgb ?? [255, 255, 255];
  };
  const over = (c, base) => c.rgb.map((v, i) => v * c.a + base[i] * (1 - c.a));
  /* The fill a reader actually sees, translucency composited. A hatch is a
     repeating gradient over a fill and reads as neither of its two colours,
     so it is taken as the mean of the stops it draws. */
  const fillOf = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return null;
    const opacity = parseFloat(cs.opacity);
    if (opacity < 0.15) return null;
    const base = behind(el);
    let c = parse(cs.backgroundColor);
    let rgb = c && c.a > 0.02 ? over(c, base) : null;
    const g = firstStop(cs.backgroundImage);
    if (g) {
      const gr = over(g, rgb ?? base);
      /* A repeating gradient is a pattern: average it with what it sits on. */
      rgb = /repeating-/.test(cs.backgroundImage)
        ? gr.map((v, i) => (v + (rgb ?? base)[i]) / 2)
        : gr;
    }
    if (!rgb) return null;
    if (opacity < 1) rgb = rgb.map((v, i) => v * opacity + base[i] * (1 - opacity));
    return rgb;
  };
  /* Anything that draws a visible line around this box. */
  const ringed = (el) => {
    const cs = getComputedStyle(el);
    if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0) return true;
    if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) return true;
    return cs.boxShadow !== "none" && /inset/.test(cs.boxShadow);
  };

  const name = (el) => (el.className?.toString?.() || el.tagName.toLowerCase()).trim().slice(0, 30);

  const out = [];
  for (const parent of document.querySelectorAll("*")) {
    const kids = [...parent.children].filter((el) => {
      if ((el.className?.toString?.() || "").includes("maplibregl")) return false;
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 6 && r.height >= 6 && fillOf(el);
    });
    if (kids.length < 2) continue;
    for (let i = 0; i + 1 < kids.length; i += 1) {
      const a = kids[i];
      const b = kids[i + 1];
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      /* Only colours a reader sees meeting. A gap shows the track between. */
      const gapX = Math.max(ra.left - rb.right, rb.left - ra.right);
      const gapY = Math.max(ra.top - rb.bottom, rb.top - ra.bottom);
      if (Math.max(gapX, gapY) > 0.5) continue;
      if (ringed(a) || ringed(b)) continue;
      const fa = fillOf(a);
      const fb = fillOf(b);
      const L1 = lum(fa);
      const L2 = lum(fb);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      out.push({ kind: "adjacent", ratio: +ratio.toFixed(2), a: name(a), b: name(b) });
    }
  }

  /* A fill inside the track it is measured on. */
  for (const el of document.querySelectorAll("*")) {
    if ((el.className?.toString?.() || "").includes("maplibregl")) continue;
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const r = el.getBoundingClientRect();
    /* Tracks are short. A card inside a section is not a bar inside a ruler,
       and the pair that matters is always a thin one. */
    if (r.width < 6 || r.height < 6 || r.height > 40) continue;
    const pr = parent.getBoundingClientRect();
    /* A fill that covers its parent is that parent's own surface, not a
       reading taken against it. */
    if (r.width >= pr.width - 1 && r.height >= pr.height - 1) continue;
    if (ringed(el)) continue;
    const fa = fillOf(el);
    const fb = fillOf(parent);
    if (!fa || !fb) continue;
    const L1 = lum(fa);
    const L2 = lum(fb);
    out.push({
      kind: "in track",
      ratio: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2),
      a: name(el),
      b: name(parent),
    });
  }
  return out;
};

const browser = await chromium.launch();
const worst = new Map();
let pairs = 0;

for (const os of ["light", "dark"]) {
  for (const choice of [null, "light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      colorScheme: os,
    });
    const page = await ctx.newPage();
    if (choice) await page.addInitScript((c) => localStorage.setItem("ridelens.theme", c), choice);
    await page.addInitScript((trips) => {
      try {
        localStorage.setItem("ridelens.trips", JSON.stringify(trips));
      } catch {
        /* A blocked store only means the history surfaces stay hidden. */
      }
    }, SEED_TRIPS);

    const label = `OS ${os.padEnd(5)} choice ${(choice ?? "system").padEnd(6)}`;
    let found = [];
    for (const [url, wait] of [
      [URL, ".quote-card"],
      [ORIGIN + "/trips", ".trip-row"],
    ]) {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForSelector(wait, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(url === URL ? 3500 : 900);
      found = found.concat(await page.evaluate(AUDIT));

      /* The charts live behind tabs, and a panel nobody opens is a panel
         nobody audits — the exact reason the bar got to 1.01:1. */
      if (url === URL) {
        for (const tab of await page.$$("[role=tab]")) {
          await tab.click();
          const id = await tab.getAttribute("id");
          const panel = id ? `#deck-panel-${id.replace("deck-tab-", "")}` : null;
          if (panel) {
            await page
              .waitForFunction(
                (sel) => {
                  const el = document.querySelector(sel);
                  return el && !el.hidden && el.innerText.trim().length > 20;
                },
                panel,
                { timeout: 15000 },
              )
              .catch(() => {});
          }
          await page.waitForTimeout(500);
          found = found.concat(await page.evaluate(AUDIT));
        }
      }
    }
    pairs += found.length;
    for (const f of found) {
      const key = `${f.kind} · ${f.a} | ${f.b}`;
      const prev = worst.get(key);
      if (!prev || f.ratio < prev.ratio) worst.set(key, { ...f, where: label });
    }
    console.log(`  ${label}  ${String(found.length).padStart(4)} fill pairs measured`);
    await ctx.close();
  }
}
await browser.close();

const exempt = (f) => ALLOWED.some((r) => r.a.test(f.a) || r.a.test(f.b));
const rows = [...worst.values()].sort((x, y) => x.ratio - y.ratio);
const fails = rows.filter((f) => f.ratio < NEED && !exempt(f));

console.log(`\n${pairs} fill pairs measured across six scheme combinations.`);
console.log(`The ten closest, worst first — ${NEED}:1 is WCAG 2.2 SC 1.4.11:\n`);
for (const f of rows.slice(0, 10)) {
  const flag = f.ratio < NEED ? (exempt(f) ? "allowed" : "UNDER  ") : "ok     ";
  console.log(
    `  ${flag} ${String(f.ratio).padStart(5)}:1  ${f.kind.padEnd(8)} ${f.a} | ${f.b}   (${f.where})`,
  );
}

if (fails.length > 0) {
  console.error(
    `\n${fails.length} fill pair${fails.length === 1 ? "" : "s"} under ${NEED}:1.\n` +
      `Give one of them a different fill, or a rule between them, or name it in\n` +
      `ALLOWED in scripts/fill-audit.mjs with the reason it reads anyway.\n`,
  );
  process.exit(1);
}
console.log(`\nEvery fill is at least ${NEED}:1, or named as an exemption.\n`);
