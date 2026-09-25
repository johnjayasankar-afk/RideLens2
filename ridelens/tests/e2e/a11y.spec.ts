/**
 * Accessibility, checked rather than assumed.
 *
 * Runs axe-core against the three states a rider actually sees — the empty
 * form, a results page, and the detail sheet — at the WCAG 2 A and AA rulesets.
 * Colour contrast is included deliberately: this app leans on muted greys for
 * secondary text, which is exactly where a design system quietly slips below
 * 4.5:1 and nobody notices until someone cannot read it.
 *
 * Both colour schemes are covered, because a palette that passes in light can
 * fail in dark and the tokens are defined separately for each.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const AXE = fs.readFileSync(path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8');

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
}

async function audit(page: Page, within?: string): Promise<Violation[]> {
  /*
   * Settle every entrance animation first.
   *
   * The empty state rises in with `.enter`, and axe sampling a mid-animation
   * frame measures *composited* colour: it reported `--text-4` as #6f7886 at
   * 4.1:1 when the token is #7b8594 at 4.86:1, and passed on retry once the
   * animation had finished. That is a real failure of the test rather than of
   * the palette — nobody reads a frame that exists for a fifth of a second —
   * and finishing the animations makes the audit measure what a reader sees.
   */
  await page.evaluate(() => {
    for (const animation of document.getAnimations?.() ?? []) animation.finish();
  });
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async (selector) => {
    const opts = {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      // The map is a WebGL canvas from a third-party library; its own controls
      // are audited, but axe cannot meaningfully assess the raster itself.
      rules: { 'color-contrast': { enabled: true } },
    };
    const ctx = selector ? { include: [[selector]] } : undefined;
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Violation[] }> };
    };
    const res = await (ctx ? w.axe.run(ctx, opts) : w.axe.run(document, opts));
    return res.violations;
  }, within ?? null);
}

function describe(violations: Violation[]): string {
  return violations
    .map(
      (v) =>
        `${v.impact ?? 'unknown'} · ${v.id}: ${v.help}\n${v.nodes
          .slice(0, 8)
          .map(
            (n) =>
              `    ${n.target.join(' ')}\n      ${(n.failureSummary ?? '').replace(/\n/g, ' ').slice(0, 220)}`,
          )
          .join('\n')}`,
    )
    .join('\n');
}

/** Names the fixture geocoder knows, so this suite stays deterministic. */
async function fillRoute(page: Page) {
  await page.getByTestId('pickup-input').fill('Prince');
  await page.getByRole('option').first().click({ timeout: 25_000 });
  await page.getByTestId('destination-input').fill('JFK');
  await page.getByRole('option').first().click({ timeout: 25_000 });
  await page.getByTestId('compare-button').click();
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    test('the empty form has no accessibility violations', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId('empty-state')).toBeVisible();
      const violations = await audit(page);
      expect(violations, describe(violations)).toEqual([]);
    });

    test('a results page has no accessibility violations', async ({ page }) => {
      await page.goto('/');
      await fillRoute(page);
      await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(1500);
      const violations = await audit(page);
      expect(violations, describe(violations)).toEqual([]);
    });

    test('the detail sheet has no accessibility violations', async ({ page }) => {
      await page.goto('/');
      await fillRoute(page);
      await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
      await page.getByTestId('inspect-button').first().click();
      await expect(page.getByTestId('ride-detail')).toBeVisible();
      await page.waitForTimeout(600);
      const violations = await audit(page, '[data-testid="ride-detail"]');
      expect(violations, describe(violations)).toEqual([]);
    });
  });
}

/** Tab from the top and collect everything that takes focus. */
async function tabThrough(page: Page, steps = 40): Promise<string[]> {
  const reached = new Set<string>();
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      return (
        el.getAttribute('data-testid') ??
        `${el.tagName.toLowerCase()}:${el.textContent?.trim().slice(0, 24) ?? ''}`
      );
    });
    if (id) reached.add(id);
  }
  return [...reached];
}

test('every control on the empty form is reachable by keyboard', async ({ page }) => {
  await page.goto('/');
  const reached = await tabThrough(page);
  // A control only reachable with a mouse shows up here as an absence.
  for (const required of [
    'use-current-location',
    'pickup-input',
    'destination-input',
    'party-1',
    'party-6',
  ]) {
    expect(reached, `never focused: ${required}`).toContain(required);
  }
  // Compare is deliberately NOT here: it is disabled until both endpoints are
  // chosen, and a disabled control should not be a tab stop.
  expect(reached).not.toContain('compare-button');
});

test('the compare button joins the tab order once the route is complete', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pickup-input').fill('Prince');
  await page.getByRole('option').first().click({ timeout: 25_000 });
  await page.getByTestId('destination-input').fill('JFK');
  await page.getByRole('option').first().click({ timeout: 25_000 });
  await expect(page.getByTestId('compare-button')).toBeEnabled();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reached = await tabThrough(page);
  expect(reached, 'compare is unreachable by keyboard once enabled').toContain('compare-button');
});

test('the route can be submitted with the keyboard alone', async ({ page }) => {
  await page.goto('/');

  // Type, wait for the listbox to actually appear, then drive it with the
  // keyboard. Waiting matters: suggestions are debounced, and pressing
  // ArrowDown into a list that does not exist yet proves nothing about the app.
  const pick = async (testId: string, text: string) => {
    await page.getByTestId(testId).focus();
    await page.keyboard.type(text);
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 25_000 });
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(testId)).not.toHaveValue(text);
  };

  await pick('pickup-input', 'Prince');
  await pick('destination-input', 'JFK');

  await page.getByTestId('compare-button').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
});

test('the detail sheet traps focus and closes on Escape', async ({ page }) => {
  await page.goto('/');
  await fillRoute(page);
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('inspect-button').first().click();
  const sheet = page.getByTestId('ride-detail');
  await expect(sheet).toBeVisible();

  // Wait for the dialog to take focus before tabbing. Starting the loop while
  // focus is still on the trigger behind it made this test flaky, and asserting
  // it here is the stronger claim anyway: opening the sheet must move focus
  // into the sheet, not merely keep it there afterwards.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const d = document.querySelector('[data-testid="ride-detail"]');
          return d ? d.contains(document.activeElement) : false;
        }),
      { timeout: 5_000, message: 'opening the sheet never moved focus into it' },
    )
    .toBe(true);

  // Focus must not escape the dialog: a screen-reader user tabbing through it
  // should never land back on the page behind.
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="ride-detail"]');
      const el = document.activeElement as HTMLElement | null;
      return {
        inside: dialog ? dialog.contains(el) : false,
        tag: el?.tagName ?? 'none',
        testId: el?.getAttribute('data-testid') ?? null,
        text: (el?.textContent ?? '').trim().slice(0, 40),
        dialogPresent: Boolean(dialog),
      };
    });
    expect(
      where.inside,
      `focus left the dialog after ${i + 1} tabs → ${JSON.stringify(where)}`,
    ).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('an open dialog keeps focus while the page ticks', async ({ page }) => {
  /**
   * The page re-renders once a second to age the freshness label. The sheet's
   * key handler used to be re-registered on every one of those renders, because
   * its effect depended on an `onClose` arrow that callers recreate each time —
   * and the effect's cleanup restores focus to whatever opened the dialog. So an
   * open sheet threw focus back onto the button behind it, once a second.
   *
   * It surfaced as an intermittently failing focus-trap test. It was not a
   * flake: for anyone navigating by keyboard or screen reader, the dialog was
   * ejecting them mid-sentence.
   */
  await page.goto('/');
  await fillRoute(page);
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('inspect-button').first().click();
  await expect(page.getByTestId('ride-detail')).toBeVisible();

  await page.getByTestId('sheet-close').focus();

  // Four seconds is four ticks. Focus must not move on its own.
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="ride-detail"]');
      const el = document.activeElement as HTMLElement | null;
      return {
        inside: dialog ? dialog.contains(el) : false,
        testId: el?.getAttribute('data-testid') ?? el?.tagName ?? 'none',
      };
    });
    expect(state.inside, `focus drifted to ${state.testId} after ${(i + 1) * 500}ms`).toBe(true);
  }
});
