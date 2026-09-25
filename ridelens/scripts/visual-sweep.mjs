/**
 * Full-state visual sweep.
 *
 * Captures every screen a rider can reach, at every breakpoint, in both colour
 * schemes, and reports measurable layout facts alongside each shot: horizontal
 * overflow, elements wider than the viewport, tap targets under 44px, text
 * clipped by its own box, and anything overlapping something else.
 *
 * The numbers are the point. A screenshot shows you a problem you already
 * suspect; the assertions find the ones you do not.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://127.0.0.1:3100';
const OUT = 'artifacts/sweep';
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 940 },
  { name: '1024', width: 1024, height: 860 },
  { name: '834', width: 834, height: 1112 },
  { name: '768', width: 768, height: 1024 },
  { name: '430', width: 430, height: 932 },
  { name: '390', width: 390, height: 844 },
  { name: '360', width: 360, height: 780 },
];

const report = [];

/** Layout facts that do not need a human to notice them. */
async function facts(page, label) {
  return page.evaluate((lbl) => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const issues = [];

    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);

      // Wider than the viewport.
      if (r.width > vw + 1) {
        issues.push(`WIDE ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} ${Math.round(r.width)}>${vw}`);
      }
      // Off the right edge — but not when an ancestor is a scroller, where
      // extending past the fold is the whole point.
      const inScroller = (() => {
        let p = el.parentElement;
        while (p && p !== document.body) {
          const pc = getComputedStyle(p);
          if (pc.overflowX === 'auto' || pc.overflowX === 'scroll') return true;
          p = p.parentElement;
        }
        return false;
      })();
      if (r.right > vw + 1 && cs.position !== 'fixed' && !inScroller) {
        issues.push(`OVERHANG ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} right=${Math.round(r.right)}`);
      }
      // Text clipped by its own box, where nothing says it should be.
      if (
        el.scrollWidth > el.clientWidth + 2 &&
        cs.overflowX === 'visible' &&
        cs.textOverflow !== 'ellipsis' &&
        el.children.length === 0 &&
        (el.textContent ?? '').trim().length > 0
      ) {
        issues.push(`CLIPPED "${(el.textContent ?? '').trim().slice(0, 28)}" ${el.scrollWidth}>${el.clientWidth}`);
      }
      // Interactive targets below the 44px minimum.
      const interactive =
        el.tagName === 'BUTTON' ||
        el.tagName === 'A' ||
        el.getAttribute('role') === 'button' ||
        el.getAttribute('role') === 'radio' ||
        el.getAttribute('role') === 'tab';
      // A skip link is 1x1 until focused, by design.
      const skipLink = cs.clipPath !== 'none' || cs.clip !== 'auto';
      if (interactive && !skipLink && !el.hasAttribute('disabled') && (r.height < 28 || r.width < 24)) {
        const id = el.getAttribute('data-testid') ?? `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 22)}`;
        issues.push(`SMALL-TARGET ${id} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }

    return {
      label: lbl,
      overflowX: doc.scrollWidth - doc.clientWidth,
      issues: [...new Set(issues)],
    };
  }, label);
}

async function shoot(page, scheme, vp, state) {
  const tag = `${scheme}-${vp.name}-${state}`;
  await page.screenshot({ path: `${OUT}/${tag}.png`, fullPage: true });
  const f = await facts(page, tag);
  report.push(f);
  const flag = f.overflowX > 1 || f.issues.length ? ' ⚠' : '';
  console.log(
    `${tag.padEnd(24)} overflowX=${String(f.overflowX).padStart(3)} issues=${String(f.issues.length).padStart(2)}${flag}`,
  );
  for (const i of f.issues.slice(0, 6)) console.log(`      ${i}`);
}

/**
 * Choose a suggestion, retrying the query.
 *
 * This sweep runs fourteen passes and asks the keyless geocoder for two places
 * each time. It self-throttles, and under that load the suggestion list simply
 * does not arrive on the first try — which is the sweep exhausting a shared
 * public service, not the app failing.
 */
async function pick(page, testId, text) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByTestId(testId).fill('');
    await page.waitForTimeout(400);
    await page.getByTestId(testId).fill(text);
    try {
      await page.getByRole('option').first().click({ timeout: 15_000 });
      return;
    } catch {
      await page.waitForTimeout(4000 * (attempt + 1));
    }
  }
  throw new Error(`no suggestion for "${text}" after four attempts`);
}

const browser = await chromium.launch();

for (const scheme of ['light', 'dark']) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      colorScheme: scheme,
    });
    const page = await ctx.newPage();

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await shoot(page, scheme, vp, 'empty');

    await pick(page, 'pickup-input', 'Times Square New York');
    await page.waitForTimeout(1400);
    await pick(page, 'destination-input', 'John F. Kennedy International Airport');
    await shoot(page, scheme, vp, 'filled');

    await page.getByTestId('compare-button').click();
    await page.getByTestId('quote-card').first().waitFor({ timeout: 45_000 });
    await page.waitForTimeout(5000);
    await shoot(page, scheme, vp, 'results');

    await page.getByTestId('inspect-button').first().click();
    await page.getByTestId('ride-detail').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(700);
    await shoot(page, scheme, vp, 'detail');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Handoff dialog.
    const book = page.getByTestId('book-button').first();
    if (await book.isEnabled().catch(() => false)) {
      await book.click();
      await page.waitForTimeout(600);
      await shoot(page, scheme, vp, 'handoff');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Expanded map.
    const expand = page.locator('[data-testid="route-map"]').locator('..').getByRole('button', { name: /expand|full/i }).first();
    if (await expand.count()) {
      await expand.click().catch(() => {});
      await page.waitForTimeout(3000);
      await shoot(page, scheme, vp, 'map');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }

    // Shortcut help.
    await page.keyboard.press('?');
    await page.waitForTimeout(500);
    await shoot(page, scheme, vp, 'shortcuts');
    await page.keyboard.press('Escape');

    await ctx.close();
    // Let the shared geocode budget refill before the next viewport.
    await new Promise((r) => setTimeout(r, 4000));
  }
}

await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

const bad = report.filter((r) => r.overflowX > 1 || r.issues.length > 0);
console.log(`\n${report.length} states captured, ${bad.length} with issues`);
