/**
 * Contrast audit across every scheme combination.
 *
 * `node scripts/contrast-audit.mjs [url]` against a running build.
 *
 * Resolves a gradient background rather than walking past it. The earlier
 * ad-hoc version reported the primary and booking buttons as 1.0:1 in every
 * run — they are white on a dark-green gradient — and a report with four
 * standing false positives is a report nobody reads.
 */
import { readFileSync } from "node:fs";

import { chromium } from "@playwright/test";

const URL =
  process.argv[2] ??
  "http://localhost:3000/?from=40.7549,-73.9840,A&to=40.6413,-73.7781,B&filter=ALL";

/*
 * A seeded trip log, so the surfaces that only exist once somebody has a
 * history get audited too. Without this, `.route-standing` and
 * `.recent-trip` are invisible to every run and could drift to unreadable
 * without anything noticing.
 *
 * The model version is read from the source rather than copied, so a bump
 * cannot silently stop the seed from pooling.
 */
const MODEL_VERSION = (readFileSync("src/lib/sources/ratecard/model-params.ts", "utf8").match(
  /MODEL_VERSION\s*=\s*"([^"]+)"/,
) ?? [])[1];

const SEED_TRIPS = Array.from({ length: 4 }, (_, i) => ({
  v: 1,
  id: `audit-${i}`,
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

/* Which surfaces actually rendered. An audit that silently measured an
   empty page reports zero failures and means nothing. */
const ORIGIN = URL.slice(0, URL.indexOf("/", URL.indexOf("//") + 2));

const seen = new Set();

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
  /* A gradient is a background too. Take its first opaque stop. */
  const fromGradient = (cs) => {
    const bi = cs.backgroundImage;
    if (!bi || bi === "none") return null;
    for (const m of bi.matchAll(/rgba?\([^)]+\)/g)) {
      const c = parse(m[0]);
      if (c && c.a > 0.75) return c.rgb;
    }
    return null;
  };
  const bgOf = (el) => {
    let e = el;
    while (e) {
      const cs = getComputedStyle(e);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0.75) return c.rgb;
      const g = fromGradient(cs);
      if (g) return g;
      e = e.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor)?.rgb ?? [255, 255, 255];
  };

  const fails = [];
  for (const el of document.querySelectorAll("*")) {
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.1)
      continue;
    /* Third-party widgets we do not author the internals of. */
    if ((el.className?.toString?.() || "").includes("maplibregl")) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight) || 400;
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const bg = bgOf(el);
    const L1 = lum(fg.rgb);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (ratio < need)
      fails.push({
        text: el.textContent.trim().slice(0, 26),
        cls: (el.className?.toString?.() || el.tagName.toLowerCase()).slice(0, 28),
        ratio: +ratio.toFixed(2),
        need,
      });
  }
  return fails;
};

const browser = await chromium.launch();
let total = 0;

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
        /* A blocked store just means the history surfaces stay hidden. */
      }
    }, SEED_TRIPS);

    let fails = [];
    for (const [url, wait] of [
      [URL, ".quote-card"],
      /* `URL` above shadows the global constructor, so the origin is sliced. */
      [ORIGIN + "/", ".recent-trip"],
      [ORIGIN + "/trips", ".trip-row"],
    ]) {
      await page.goto(url, { waitUntil: "load" });
      const appeared = await page
        .waitForSelector(wait, { timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      if (appeared) seen.add(wait);
      /* The standing only exists once the log has enough of this route, so it
         is noted where it is found rather than waited for. */
      if (await page.$(".route-standing")) seen.add(".route-standing");

      /* The palette is a whole surface that only exists while it is open. */
      if (wait === ".recent-trip") {
        await page.keyboard.press("ControlOrMeta+k");
        const open = await page
          .waitForSelector(".cmdk-item", { timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        if (open) seen.add(".cmdk-item");
      }
      await page.waitForTimeout(url === URL ? 3500 : 900);
      fails = fails.concat(await page.evaluate(AUDIT));
    }

    total += fails.length;
    const label = `OS ${os.padEnd(5)} choice ${String(choice ?? "system").padEnd(6)}`;
    console.log(`${label} ${fails.length === 0 ? "ok" : `${fails.length} FAIL`}`);
    for (const f of fails.slice(0, 8)) {
      console.log(`   ${String(f.ratio).padStart(5)}:1 (needs ${f.need})  ${f.cls}  "${f.text}"`);
    }
    await ctx.close();
  }
}

await browser.close();

const EXPECTED = [".quote-card", ".recent-trip", ".route-standing", ".cmdk-item", ".trip-row"];
const missing = EXPECTED.filter((sel) => !seen.has(sel));
if (missing.length > 0) {
  console.error(
    `\nNothing matched ${missing.join(", ")} in any run. The audit measured a page that` +
      ` never rendered the surface it exists to check — fix the seed or the selector` +
      ` rather than trusting the zero above.`,
  );
  process.exit(1);
}

if (total > 0) {
  console.error(`\n${total} contrast failures. Pick the token for the job — see docs/A11Y.md.`);
  process.exit(1);
}
console.log("\nEvery scheme combination clears WCAG 2.2 AA.");
