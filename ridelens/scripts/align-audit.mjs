/**
 * Near-miss alignment audit.
 *
 * Nothing here is broken in the sense a layout test would catch: no overflow,
 * no clipping. This looks for the other thing — edges that are *almost* the
 * same. Two panels whose left edges differ by 2px, a heading sitting 3px off
 * the column it belongs to. Individually invisible, collectively the reason an
 * interface reads as approximate.
 *
 * A pair is flagged when two prominent block edges are within 6px of each other
 * and not equal. Equal is fine. Far apart is fine — that is a deliberate indent.
 * It is the near miss that is never on purpose.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_URL ?? 'http://127.0.0.1:3100';
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 940 },
  { name: '1024', width: 1024, height: 860 },
  { name: '390', width: 390, height: 844 },
];

async function audit(page, label) {
  return page.evaluate((lbl) => {
    const TOL = 6;

    const describe = (el) => {
      const id = el.getAttribute('data-testid');
      const cls = String(el.className).split(' ').filter(Boolean).slice(0, 1).join('');
      return id ? `[${id}]` : cls ? `.${cls}` : el.tagName.toLowerCase();
    };

    const laidOut = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cs.position === 'absolute' || cs.position === 'fixed') return false;
      // Only structural blocks. Inline text carries its own box edges and
      // floods the result with pairs that were never meant to line up.
      if (!['block', 'flex', 'grid'].includes(cs.display)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 8;
    };

    /**
     * Siblings, and only siblings.
     *
     * Two blocks in the same container are stacked in one column and belong on
     * one line. Two blocks in different containers — a map control and a filter
     * pill — have no reason to agree, and comparing them produces noise that
     * buries the real thing.
     */
    const near = [];
    const parents = new Set();
    for (const el of document.querySelectorAll('main *, aside *, .rl-appbar *')) {
      if (el.parentElement) parents.add(el.parentElement);
    }

    for (const parent of parents) {
      const kids = [...parent.children].filter(laidOut);
      if (kids.length < 2) continue;
      const pcs = getComputedStyle(parent);
      // A row lays its children out horizontally, so their left edges are meant
      // to differ. Only stacked children share a column.
      const isRow =
        (pcs.display === 'flex' && !pcs.flexDirection.startsWith('column')) ||
        (pcs.display === 'grid' && pcs.gridTemplateColumns.split(' ').length > 1);
      if (isRow) continue;

      for (const side of ['left', 'right']) {
        const seen = kids.map((el) => ({
          v: Math.round(el.getBoundingClientRect()[side]),
          el,
        }));
        for (let i = 0; i < seen.length; i += 1) {
          for (let j = i + 1; j < seen.length; j += 1) {
            const d = Math.abs(seen[i].v - seen[j].v);
            if (d > 0 && d <= TOL) {
              near.push(
                `${side.toUpperCase()} in ${describe(parent)}: ` +
                  `${describe(seen[i].el)}@${seen[i].v} vs ${describe(seen[j].el)}@${seen[j].v} (${d}px)`,
              );
            }
          }
        }
      }
    }
    return { label: lbl, near: [...new Set(near)] };
  }, label);
}

const browser = await chromium.launch();
let totalIssues = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const empty = await audit(page, `${vp.name}-empty`);

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
    throw new Error(`no suggestion for ${text}`);
  };
  await pick('pickup-input', 'Union Square New York');
  await page.waitForTimeout(1400);
  await pick('destination-input', 'Washington Square Park New York');
  await page.getByTestId('compare-button').click();
  await page.getByTestId('quote-card').first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(4000);
  const results = await audit(page, `${vp.name}-results`);

  for (const r of [empty, results]) {
    totalIssues += r.near.length;
    console.log(`${r.label.padEnd(16)} near-misses=${r.near.length}${r.near.length ? ' ⚠' : ''}`);
    for (const n of r.near) console.log(`      ${n}`);
  }

  await ctx.close();
  await new Promise((r) => setTimeout(r, 4000));
}

await browser.close();
console.log(`\ntotal near-miss alignments: ${totalIssues}`);
