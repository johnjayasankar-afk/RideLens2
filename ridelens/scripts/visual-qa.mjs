/**
 * Visual QA sweep. Drives the real app at four widths in both colour schemes,
 * captures screenshots and reports layout facts we can assert on: horizontal
 * overflow, tap-target size, and whether the route map actually painted tiles.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://127.0.0.1:3399';
const WIDTHS = [
  { name: '1440', width: 1440, height: 940 },
  { name: '1024', width: 1024, height: 860 },
  { name: '768', width: 768, height: 960 },
  { name: '390', width: 390, height: 844 },
];
const SCHEMES = ['light', 'dark'];

const browser = await chromium.launch();
const report = [];

for (const scheme of SCHEMES) {
  for (const vp of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      colorScheme: scheme,
    });
    const page = await context.newPage();

    let tilesOk = 0;
    let cspViolations = 0;
    page.on('response', (r) => {
      if (r.url().includes('tile.openstreetmap.org') && r.status() === 200) tilesOk += 1;
    });
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) cspViolations += 1;
    });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    const tag = `${scheme}-${vp.name}`;
    await page.screenshot({ path: `artifacts/qa-${tag}-empty.png` });

    // Full place names, and a pause between the two lookups: the keyless
    // geocoder self-throttles to about one request a second, and a short
    // ambiguous query ("Prince", "JFK") can resolve to another continent.
    await page.getByTestId('pickup-input').fill('Times Square New York');
    await page.getByRole('option').first().click({ timeout: 25000 });
    await page.waitForTimeout(1400);
    await page.getByTestId('destination-input').fill('John F. Kennedy International Airport');
    await page.getByRole('option').first().click({ timeout: 25000 });

    await page.getByTestId('compare-button').click();
    await page.screenshot({ path: `artifacts/qa-${tag}-loading.png` });

    await page.getByTestId('quote-card').first().waitFor({ timeout: 40000 });
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `artifacts/qa-${tag}-results.png`, fullPage: true });

    // Detail sheet — the transparency panel.
    await page.getByTestId('inspect-button').first().click();
    await page.getByTestId('ride-detail').waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `artifacts/qa-${tag}-detail.png` });
    await page.keyboard.press('Escape');

    const facts = await page.evaluate(() => {
      const doc = document.documentElement;
      const btn = document.querySelector('[data-testid="book-button"]');
      const offenders = [];
      for (const el of document.querySelectorAll('main *, aside *')) {
        const r = el.getBoundingClientRect();
        if (r.width > doc.clientWidth + 1) {
          offenders.push(`${el.tagName}.${String(el.className).slice(0, 26)}`);
        }
      }
      // Contrast smoke test: body text must not equal the page background.
      const cs = getComputedStyle(document.body);
      return {
        overflowX: doc.scrollWidth - doc.clientWidth,
        cards: document.querySelectorAll('[data-testid="quote-card"]').length,
        bookButtonHeight: btn ? Math.round(btn.getBoundingClientRect().height) : null,
        heroPrice: document.querySelector('[data-testid="quote-price"]')?.textContent ?? null,
        bg: cs.backgroundColor,
        fg: cs.color,
        wideElements: offenders.slice(0, 3),
      };
    });

    report.push({ scheme, viewport: vp.name, tilesOk, cspViolations, ...facts });
    await context.close();
    // Let the shared geocode budget refill before the next viewport.
    await new Promise((r) => setTimeout(r, 1500));
  }
}

await browser.close();
fs.writeFileSync('artifacts/qa-report.json', JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(
    `${r.scheme.padEnd(5)} ${r.viewport.padEnd(5)} overflow=${r.overflowX} cards=${r.cards} cta=${r.bookButtonHeight}px tiles=${r.tilesOk} csp=${r.cspViolations} wide=${r.wideElements.length} price=${r.heroPrice}`,
  );
}
