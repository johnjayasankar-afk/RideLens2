/**
 * What a visitor actually downloads, and when they can use the page.
 *
 * Bundle totals on disk are not the number that matters — most of this app's
 * JavaScript is MapLibre, and the map does not exist until a comparison has
 * run. What matters is the weight on the critical path: bytes before the form
 * is usable, and bytes added later when the map appears.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.PERF_URL ?? 'http://127.0.0.1:3200';
const browser = await chromium.launch();

async function measure(label, drive) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const bytes = { js: 0, css: 0, img: 0, other: 0 };
  const seen = new Set();
  page.on('response', async (r) => {
    const url = r.url();
    if (seen.has(url)) return;
    seen.add(url);
    const type = r.request().resourceType();
    let len = Number(r.headers()['content-length'] ?? 0);
    if (!len) {
      try {
        len = (await r.body()).length;
      } catch {
        len = 0;
      }
    }
    if (type === 'script') bytes.js += len;
    else if (type === 'stylesheet') bytes.css += len;
    else if (type === 'image') bytes.img += len;
    else bytes.other += len;
  });

  await page.goto(BASE, { waitUntil: 'load' });
  const paint = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      ttfbMs: nav ? Math.round(nav.responseStart) : null,
      domReadyMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
    };
  });
  const before = { ...bytes };
  if (drive) await drive(page);
  await ctx.close();

  const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
  console.log(
    `${label.padEnd(22)} js=${kb(before.js).padStart(7)} css=${kb(before.css).padStart(6)} ` +
      `img=${kb(before.img).padStart(6)}  ttfb=${paint.ttfbMs}ms fcp=${paint.fcpMs}ms dom=${paint.domReadyMs}ms`,
  );
  if (drive) {
    console.log(
      `${''.padEnd(22)} after driving: js=${kb(bytes.js)} (+${kb(bytes.js - before.js)})`,
    );
  }
}

await measure('landing (idle)');

await measure('landing → results', async (page) => {
  const pick = async (id, text) => {
    for (let a = 0; a < 4; a += 1) {
      await page.getByTestId(id).fill('');
      await page.waitForTimeout(400);
      await page.getByTestId(id).fill(text);
      try {
        await page.getByRole('option').first().click({ timeout: 15_000 });
        return;
      } catch {
        await page.waitForTimeout(4000 * (a + 1));
      }
    }
  };
  await pick('pickup-input', 'Union Square New York');
  await page.waitForTimeout(1400);
  await pick('destination-input', 'Washington Square Park New York');
  await page.getByTestId('compare-button').click();
  await page.getByTestId('quote-card').first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(6000);
});

await browser.close();
