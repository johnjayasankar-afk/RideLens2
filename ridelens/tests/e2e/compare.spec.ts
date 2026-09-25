/**
 * End-to-end flows against the real built app.
 *
 * External sources are replaced by the deterministic fixture source
 * (RIDELENS_DEMO_SOURCE=enabled, non-production only) and the fixture
 * geocoder, so assertions are stable. Everything else — routing, streaming,
 * ranking, the allowlist — is the production code path.
 */
import { expect, test, type Page } from '@playwright/test';

async function fillRoute(page: Page, pickup = 'Prince', destination = 'JFK') {
  await page.getByTestId('pickup-input').fill(pickup);
  await page.getByRole('option').first().click();
  await page.getByTestId('destination-input').fill(destination);
  await page.getByRole('option').first().click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('anonymous visitor can compare without signing up', async ({ page }) => {
  await expect(page.getByTestId('empty-state')).toBeVisible();
  // No auth wall anywhere in the first-run path.
  await expect(page.getByText(/sign up|create an account|log in/i)).toHaveCount(0);

  await fillRoute(page);
  await page.getByTestId('compare-button').click();

  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });
  expect(await page.getByTestId('quote-card').count()).toBeGreaterThan(2);
});

test('destination autocomplete offers suggestions and confirms the selection', async ({ page }) => {
  await page.getByTestId('destination-input').fill('JFK');
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByTestId('destination-input')).toHaveValue(/JFK/);
});

test('autocomplete is keyboard navigable', async ({ page }) => {
  const input = page.getByTestId('pickup-input');
  await input.fill('Prince');
  await expect(page.getByRole('option').first()).toBeVisible();
  await input.press('ArrowDown');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(input).toHaveValue(/Prince/);
});

test('cheapest option is the hero and carries an honest savings line', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  const hero = page.getByTestId('quote-card').first();
  // Fixture pricing makes Empower Everyday the cheapest standard-equivalent ride.
  await expect(hero).toHaveAttribute('data-provider', 'empower');
  await expect(hero.getByTestId('savings-line')).toBeVisible();
  await expect(hero.getByTestId('quote-price')).toContainText('$');
});

test('a range is displayed as a range, never as a midpoint', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('filter-ALL').click();
  const rangeCard = page.locator('[data-price-type="ESTIMATE_RANGE"]').first();
  await expect(rangeCard).toBeVisible();
  // An en dash between two numbers is the range; a single price would have none.
  await expect(rangeCard.getByTestId('quote-price')).toContainText('–');
  await expect(rangeCard.getByTestId('price-qualifier')).toContainText(/Est/i);
});

test('an upfront quote is labelled upfront', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  const upfront = page.locator('[data-price-type="UPFRONT_QUOTE"]').first();
  await expect(upfront).toBeVisible();
  await expect(upfront.getByTestId('price-qualifier')).toContainText(/Upfront/i);
});

test('filters partition results and keep luxury out of the default view', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  // Default BEST view: no XL and no luxury alongside standard cars.
  await expect(page.locator('[data-category="XL"]')).toHaveCount(0);
  await expect(page.locator('[data-category="LUXURY"]')).toHaveCount(0);
  await expect(page.locator('[data-category="TAXI"]').first()).toBeVisible();

  await page.getByTestId('filter-XL').click();
  await expect(page.locator('[data-category="XL"]').first()).toBeVisible();
  await expect(page.locator('[data-category="STANDARD"]')).toHaveCount(0);

  await page.getByTestId('filter-ALL').click();
  expect(await page.getByTestId('quote-card').count()).toBeGreaterThan(4);
});

test('sorting by fastest pickup reorders the list', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  const cheapestFirst = await page.getByTestId('quote-card').first().getAttribute('data-provider');
  await page.getByTestId('mode-FASTEST').click();
  // Fixture ETAs put Uber's 2-minute pickup first.
  await expect(page.getByTestId('quote-card').first()).toHaveAttribute('data-provider', 'uber');
  expect(cheapestFirst).not.toBe('uber');
});

test('refresh re-runs the comparison and updates the timestamp', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId('updated-label')).toContainText(/Updated/);
  await page.getByTestId('refresh-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('updated-label')).toContainText(/Updated/);
});

test('an unavailable product is shown as unavailable, not priced as bookable', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('filter-ALL').click();

  const unavailable = page.locator('[data-bookable="false"]').first();
  await expect(unavailable).toBeVisible();
  await expect(unavailable.getByTestId('book-button')).toBeDisabled();
  await expect(unavailable).toContainText(/No vehicles available/i);
});

test('booking shows an interstitial that restates the route and price', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('quote-card').first().getByTestId('book-button').click();
  const dialog = page.getByTestId('handoff-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Pickup');
  await expect(dialog).toContainText('Destination');
  await expect(dialog).toContainText('Observed');
  await expect(dialog).toContainText(/Updated/);
  // The promotions caveat is always stated.
  await expect(dialog).toContainText(/promotions or credits/i);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('booking handoff resolves to an allowlisted provider domain', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('quote-card').first().getByTestId('book-button').click();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/handoff')),
    page.getByTestId('handoff-continue').click(),
  ]);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { host: string };
  expect([
    'm.uber.com',
    'ride.lyft.com',
    'lyft.com',
    'gocurb.com',
    'www.rideempower.com',
  ]).toContain(body.host);
});

test('fixture-backed sessions are labelled as not live', async ({ page }) => {
  await expect(page.getByTestId('fixture-banner')).toBeVisible();
  await expect(page.getByTestId('fixture-banner')).toContainText(/not a live market price/i);

  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('freshness').first()).toContainText(/Fixture data/i);
});

test('every card answers who, how much, how soon, what type, how fresh', async ({ page }) => {
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  const card = page.getByTestId('quote-card').first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  await expect(card).toContainText(/Empower|Uber|Lyft|Curb/);
  await expect(card.getByTestId('quote-price')).toContainText('$');
  await expect(card).toContainText(/pickup/);
  await expect(card).toContainText(/Standard|Taxi|XL|Premium|Electric/);
  await expect(card.getByTestId('freshness')).toBeVisible();
});
