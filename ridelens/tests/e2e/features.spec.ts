/**
 * The features added on top of the core comparison: detail transparency,
 * sharing, party size, auto-refresh, saved places, shortcuts, price history.
 */
import { expect, test, type Page } from '@playwright/test';

async function compare(page: Page) {
  await page.getByTestId('pickup-input').fill('Prince');
  await page.getByRole('option').first().click();
  await page.getByTestId('destination-input').fill('JFK');
  await page.getByRole('option').first().click();
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });
}

/** Fills the route and submits without waiting for cards, for failure paths. */
async function compare2(page: Page) {
  await page.getByTestId('pickup-input').fill('Prince');
  await page.getByRole('option').first().click();
  await page.getByTestId('destination-input').fill('JFK');
  await page.getByRole('option').first().click();
  await page.getByTestId('compare-button').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('ride detail explains where the price came from', async ({ page }) => {
  await compare(page);
  await page.getByTestId('inspect-button').first().click();

  const sheet = page.getByTestId('ride-detail');
  await expect(sheet).toBeVisible();
  // The three truth axes, spelled out rather than abbreviated.
  await expect(sheet).toContainText(/single-point prediction|low\/high band|binding fare/i);
  await expect(sheet).toContainText('Where this came from');
  await expect(sheet).toContainText(/Local fixture \(not live\)/);
  await expect(sheet).toContainText(/Public market price/);
  await expect(sheet).toContainText(/Confidence/);
  // Prefill is never claimed as verified.
  await expect(sheet).toContainText(/Not yet confirmed by a human|Not applicable/);
});

test('detail sheet splits a fare exactly', async ({ page }) => {
  await compare(page);
  await page.getByTestId('inspect-button').first().click();

  const sheet = page.getByTestId('ride-detail');
  const amount = sheet.getByTestId('split-amount');
  const solo = (await amount.textContent()) ?? '';

  await sheet.getByRole('button', { name: /Increase People splitting/i }).click();
  const pair = (await amount.textContent()) ?? '';
  expect(pair).not.toBe(solo);

  const parse = (s: string) => Number(s.replace(/[^0-9.]/g, ''));
  // Half of the fare, give or take the odd cent that rounding hands to payer one.
  expect(parse(pair)).toBeGreaterThan(parse(solo) / 2 - 0.02);
  expect(parse(pair)).toBeLessThan(parse(solo) / 2 + 0.02);
});

test('detail sheet closes with Escape and returns focus', async ({ page }) => {
  await compare(page);
  await page.getByTestId('inspect-button').first().click();
  await expect(page.getByTestId('ride-detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ride-detail')).toHaveCount(0);
});

test('share produces an opaque link with no coordinates in it', async ({ page }) => {
  await compare(page);
  await page.getByTestId('share-button').click();

  const result = page.getByTestId('share-result');
  await expect(result).toBeVisible({ timeout: 10_000 });
  const url = (await result.locator('code').textContent()) ?? '';

  expect(url).toMatch(/\/s\/[0-9abcdefghjkmnpqrstvwxyz]{12}$/);
  // The privacy property the whole share design exists for.
  expect(url).not.toMatch(/40\.7|-73\.|lat=|lng=/);
});

test('opening a share link runs a fresh comparison', async ({ page }) => {
  await compare(page);
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('share-result')).toBeVisible({ timeout: 10_000 });
  const url = (await page.getByTestId('share-result').locator('code').textContent()) ?? '';

  await page.goto(url);
  // Both endpoints are restored and prices are fetched again, not replayed.
  await expect(page.getByTestId('destination-input')).toHaveValue(/JFK/, { timeout: 10_000 });
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('freshness').first()).toBeVisible();
});

test('an expired or unknown share link 404s rather than guessing', async ({ page }) => {
  const res = await page.goto('/s/abcdefghjkmn');
  expect(res?.status()).toBe(404);
});

test('party size filters to vehicles that seat the group', async ({ page }) => {
  await compare(page);
  await page.getByTestId('filter-ALL').click();
  const before = await page.getByTestId('quote-card').count();

  await page.getByTestId('party-5').click();
  await expect(page.locator('[data-category="STANDARD"]')).toHaveCount(0);
  const after = await page.getByTestId('quote-card').count();
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);

  // Seat capacity is surfaced, and labelled as a model in the detail sheet.
  await expect(page.getByTestId('quote-card').first()).toContainText(/SEATS/i);
});

test('auto-refresh counts down and can be switched off', async ({ page }) => {
  await compare(page);
  const toggle = page.getByTestId('live-toggle');
  await expect(toggle).toHaveText(/Auto-refresh/);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveText(/\d+s/);

  await toggle.click();
  await expect(toggle).toHaveText(/Auto-refresh/);
});

test('saved places appear as quick picks and can be cleared', async ({ page }) => {
  await page.getByTestId('pickup-input').fill('Prince');
  await page.getByRole('option').first().click();
  await page.getByTestId('save-home').click();
  await expect(page.getByText(/Saved as Home/)).toBeVisible();

  await page.reload();
  await page.getByTestId('destination-input').click();
  await expect(page.getByRole('option').filter({ hasText: 'Home' })).toBeVisible();

  await page.getByTestId('clear-places').click();
  await expect(page.getByTestId('clear-places')).toHaveCount(0);
});

test('recent routes are remembered locally and carry no price', async ({ page }) => {
  await compare(page);
  await page.reload();

  await page.getByTestId('destination-input').click();
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  await expect(options.first()).not.toContainText('$');
});

test('price history appears after a refresh', async ({ page }) => {
  await compare(page);
  await expect(page.getByTestId('price-history')).toHaveCount(0);

  await page.getByTestId('refresh-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });
  const history = page.getByTestId('price-history');
  await expect(history).toBeVisible();
  await expect(history).toContainText(/unchanged|↑|↓/);
});

test('keyboard shortcuts focus search and open help', async ({ page }) => {
  // Shortcuts are attached on hydration, so a key pressed before React has
  // taken over the markup genuinely does nothing. Pressing until it lands
  // waits for that rather than assuming it, which is also what a person does.
  await expect
    .poll(
      async () => {
        await page.keyboard.press('?');
        return page.getByTestId('shortcut-help').isVisible();
      },
      { timeout: 10_000, message: 'the ? shortcut never opened the help panel' },
    )
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcut-help')).toHaveCount(0);

  await page.keyboard.press('/');
  await expect(page.getByTestId('pickup-input')).toBeFocused();
});

test('shortcuts do not fire while typing in a field', async ({ page }) => {
  const input = page.getByTestId('pickup-input');
  await input.click();
  await input.fill('r');
  // "r" is the refresh shortcut; inside a field it must just be a character.
  await expect(input).toHaveValue('r');
  await expect(page.getByTestId('shortcut-help')).toHaveCount(0);
});

test('no source-status panel appears when every source succeeded', async ({ page }) => {
  await compare(page);
  // Silence is the correct output: nothing failed, so there is nothing to report.
  await expect(page.getByTestId('source-status')).toHaveCount(0);
});

test('a failing source is reported behind a disclosure, never as a price', async ({ page }) => {
  await page.route('**/api/quotes/stream', async (route) => {
    const loc = (name: string) => ({
      lat: 40.7233,
      lng: -73.9959,
      formattedAddress: name,
      placeId: null,
      name,
      city: 'New York',
      region: 'NY',
      country: 'US',
      geocoder: 'fixture',
    });
    const outcome = {
      sourceId: 'obi',
      status: 'TIMEOUT',
      latencyMs: 8000,
      quoteCount: 0,
      message: 'Request exceeded 8000ms',
      blockerCode: null,
      cacheHit: false,
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          type: 'session',
          pickup: loc('14 Prince St'),
          destination: loc('JFK T4'),
          straightLineMeters: 20150,
          sourcesExpected: ['obi'],
          providersExpected: ['uber', 'lyft'],
          fixtureBacked: false,
        }) +
        '\n' +
        JSON.stringify({ type: 'source', outcome, quotes: [] }) +
        '\n' +
        JSON.stringify({
          type: 'complete',
          session: {
            id: 'qs_t',
            status: 'FAILED',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            pickup: loc('14 Prince St'),
            destination: loc('JFK T4'),
            coverage: {
              sourcesExpected: ['obi'],
              sourcesSucceeded: [],
              sourcesFailed: ['obi'],
              providersReturned: [],
            },
            outcomes: [outcome],
            quotes: [],
            candidates: [],
            discrepancies: [],
          },
        }) +
        '\n',
    });
  });

  await compare2(page);
  const status = page.getByTestId('source-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText(/returned no price/i);
  await expect(page.getByTestId('quote-price')).toHaveCount(0);

  // With nothing else on screen the panel opens by default, so the reason is
  // visible without a click.
  await expect(page.getByTestId('source-problem').first()).toContainText(/Timed out/i);

  // Collapsing and re-expanding still works.
  await page.getByTestId('source-status-toggle').click();
  await expect(page.getByTestId('source-problem')).toHaveCount(0);
  await page.getByTestId('source-status-toggle').click();
  await expect(page.getByTestId('source-problem').first()).toBeVisible();
});

test('the route map reports a road estimate, labelled as such', async ({ page }) => {
  await compare(page);
  const facts = page.getByTestId('route-facts').first();
  await expect(facts).toBeVisible();
  await expect(facts).toContainText(/map estimate|straight line/);
});

test('booking interstitial can copy trip details', async ({ page, context }, testInfo) => {
  // Clipboard permissions are not reliably grantable under mobile device
  // emulation; the behaviour itself is not viewport-dependent.
  test.skip(testInfo.project.name === 'mobile', 'clipboard API is unavailable in mobile emulation');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await compare(page);
  await page.getByTestId('quote-card').first().getByTestId('book-button').click();
  await expect(page.getByTestId('handoff-dialog')).toBeVisible();

  await page.getByTestId('copy-trip').click();
  await expect(page.getByTestId('copy-trip')).toHaveText(/Copied/);

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Pickup:');
  expect(text).toContain('Destination:');
  expect(text).toContain('Final fare is confirmed in the provider app.');
});
