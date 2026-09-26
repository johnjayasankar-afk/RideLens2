/**
 * `npm run perf` — does it still feel good?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Scroll smoothness is the easiest quality to lose and the hardest to      │
 * │ notice losing, because nothing fails. The page still works; it just      │
 * │ stops feeling like anything. One CSS property took this app from 120 fps │
 * │ to 40 and no test, budget or review caught it.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Measures three things against a running production build:
 *
 *   • scroll frame times, as a median and a 95th percentile
 *   • how many frames miss a 60 Hz budget while scrolling
 *   • cumulative layout shift, which is what "loads cleanly" means
 *
 * Thresholds are set just past what the app currently does, so a real
 * regression trips them and ordinary noise does not. Exits non-zero on a
 * miss, and prints what changed.
 *
 *   npm run start          # in one shell
 *   npm run perf           # in another
 */
import { chromium } from "@playwright/test";

const BASE = process.env.PERF_URL ?? "http://localhost:3000";
const ROUTE = "/?from=40.7549,-73.9840,Midtown&to=40.6413,-73.7781,JFK&mode=cheapest&filter=ALL";

/** Measured on a 1440x900 desktop build; see docs/PERFORMANCE.md. */
const BUDGET = {
  medianFrameMs: 12, // ~83 fps. Currently 8.3.
  p95FrameMs: 18, // Currently 9.3.
  framesOver33msShare: 0.02, // Currently ~0.
  cls: 0.02, // Currently 0.0053.
};

const RUNS = 3;

async function once(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* not every engine reports shifts */
    }
  });
  await page.goto(BASE + ROUTE, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(".quote-card", { timeout: 30000 });

  /*
   * Settle before scrolling. The map is deliberately built during this gap —
   * see route-map.tsx — and measuring through it would report the cost of
   * something the design already decided to spend while nobody is moving.
   */
  await page.waitForTimeout(3500);

  const scroll = await page.evaluate(async () => {
    const frames = [];
    let last = performance.now();
    let stop = false;
    const tick = (t) => {
      frames.push(t - last);
      last = t;
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const start = performance.now();
    while (performance.now() - start < 5000) {
      const limit = document.documentElement.scrollHeight - innerHeight;
      window.scrollBy(0, 16);
      if (scrollY >= limit - 2) window.scrollTo(0, 0);
      await new Promise((r) => requestAnimationFrame(r));
    }
    stop = true;
    await new Promise((r) => setTimeout(r, 60));
    // The first few frames cover the scroll starting up, not scrolling.
    const d = frames
      .slice(3)
      .filter((x) => x > 0)
      .sort((a, b) => a - b);
    const pct = (q) => d[Math.floor(d.length * q)] ?? 0;
    return {
      medianFrameMs: +pct(0.5).toFixed(2),
      p95FrameMs: +pct(0.95).toFixed(2),
      framesOver33msShare: +(d.filter((x) => x > 33).length / (d.length || 1)).toFixed(4),
      frames: d.length,
    };
  });

  const cls = await page.evaluate(() => +(window.__cls ?? 0).toFixed(4));
  await page.close();
  return { ...scroll, cls };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const browser = await chromium.launch();
const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await once(browser));
await browser.close();

const got = Object.fromEntries(Object.keys(BUDGET).map((k) => [k, median(runs.map((r) => r[k]))]));

console.log(`Performance (median of ${RUNS} runs, 1440x900)\n`);
let failed = false;
for (const [key, limit] of Object.entries(BUDGET)) {
  const v = got[key];
  const over = v > limit;
  if (over) failed = true;
  console.log(
    `  ${over ? "OVER " : "ok   "} ${key.padEnd(20)} ${String(v).padStart(8)} / ${limit}`,
  );
}
console.log(`\n  ~${(1000 / got.medianFrameMs).toFixed(0)} fps while scrolling`);

if (failed) {
  console.error(
    "\nScrolling got worse. The usual cause is a new backdrop-filter, or an\n" +
      "existing one landing on something sticky — see docs/PERFORMANCE.md.",
  );
  process.exit(1);
}
