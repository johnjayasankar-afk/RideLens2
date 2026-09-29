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

/**
 * Two viewports, because the app had only ever been measured on one.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This ran at 1440x900 and nothing else, and a rider opens this on a       │
 * │ phone. The gap is not theoretical: `.mobile-compare-bar` is sticky,      │
 * │ bottom-anchored, full width and carries `backdrop-filter: blur(10px)` —  │
 * │ the exact pattern globals.css refuses by name for the topbar — and it    │
 * │ lives inside `@media (max-width: 959px)`, so every run this harness has  │
 * │ ever done was blind to it.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The phone's thresholds are its own. A 390px viewport paints far less per
 * frame than a 1440px one, so holding it to the desktop numbers would be a
 * ceiling nothing could ever reach — and holding the desktop to the phone's
 * would be a ceiling nothing could ever break.
 */
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Measured on a 1440x900 desktop build; see docs/PERFORMANCE.md. */
const BUDGET = {
  medianFrameMs: 12, // ~83 fps. Currently 8.3.
  p95FrameMs: 18, // Currently 9.3.
  framesOver33msShare: 0.02, // Currently ~0.
  /*
   * Currently ~0.002, down from 0.0053, in two steps.
   *
   * First the console's loading placeholder was made the same height as the
   * row it stands in for. Then the refresh bar came out of the results grid:
   * as a grid item it cost 2px of bar plus 16px of gap, so every auto-refresh
   * pushed the comparison down 22px and pulled it back. That one only showed
   * up when a refresh landed inside the five-second window, which made this
   * check fail about one run in three for no reason anybody could see — and
   * a guard that fails at random is a guard that gets ignored.
   *
   * (The first diagnosis blamed the web font wrapping the modeled-estimate
   * banner to a third line. Measured with the font requests blocked, the
   * banner is 61.5px either way. Worth saying so here, so nobody re-derives
   * the wrong answer from the same symptom.)
   */
  cls: 0.02,
};

/*
 * Set at what a phone measures today, with the same slack the desktop budget
 * uses. Deliberately not tighter: the point of a second viewport is to catch
 * a regression that only exists there, not to fail on the noise of a machine
 * whose load swings by an order of magnitude.
 */
const PHONE_BUDGET = {
  medianFrameMs: 14,
  p95FrameMs: 22,
  framesOver33msShare: 0.03,
  cls: 0.02,
};

const RUNS = 3;

async function once(browser, viewport) {
  const page = await browser.newPage({ viewport });
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

/*
 * Interleaved, not one viewport then the other. This machine's load swings by
 * an order of magnitude over a few minutes, so three desktop runs followed by
 * three phone runs measures the machine as much as the app. Alternating them
 * puts both viewports under the same conditions.
 */
const desktopRuns = [];
const phoneRuns = [];
for (let i = 0; i < RUNS; i++) {
  desktopRuns.push(await once(browser, DESKTOP));
  phoneRuns.push(await once(browser, PHONE));
}
await browser.close();

let failed = false;

function report(label, runs, budget) {
  const got = Object.fromEntries(
    Object.keys(budget).map((k) => [k, median(runs.map((r) => r[k]))]),
  );
  console.log(`Performance (median of ${RUNS} runs, ${label})\n`);
  for (const [key, limit] of Object.entries(budget)) {
    const v = got[key];
    const over = v > limit;
    if (over) failed = true;
    console.log(
      `  ${over ? "OVER " : "ok   "} ${key.padEnd(20)} ${String(v).padStart(8)} / ${limit}`,
    );
  }
  console.log(`\n  ~${(1000 / got.medianFrameMs).toFixed(0)} fps while scrolling\n`);
  return got;
}

const got = report(`${DESKTOP.width}x${DESKTOP.height}`, desktopRuns, BUDGET);
report(`${PHONE.width}x${PHONE.height}`, phoneRuns, PHONE_BUDGET);

if (failed) {
  console.error(
    "\nScrolling got worse. The usual cause is a new backdrop-filter, or an\n" +
      "existing one landing on something sticky — see docs/PERFORMANCE.md.",
  );
  process.exit(1);
}
