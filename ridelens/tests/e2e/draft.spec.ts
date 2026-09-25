/**
 * A reload should not lose the route you were looking at.
 *
 * Deliberately not in the URL: a pickup and destination in the address bar land
 * in browser history, in the referrer of every outbound link, and in any log
 * that records a path. The share feature answers "give me a link" with an
 * opaque id for exactly that reason. `sessionStorage` is scoped to one tab,
 * survives a reload, and never leaves the browser.
 */
import { expect, test, type Page } from '@playwright/test';

async function fillRoute(page: Page) {
  await page.getByTestId('pickup-input').fill('Prince');
  await page.getByRole('option').first().click({ timeout: 25_000 });
  await page.getByTestId('destination-input').fill('JFK');
  await page.getByRole('option').first().click({ timeout: 25_000 });
}

test('a reload keeps the route in the form', async ({ page }) => {
  await page.goto('/');
  await fillRoute(page);
  const pickup = await page.getByTestId('pickup-input').inputValue();
  const destination = await page.getByTestId('destination-input').inputValue();
  expect(pickup.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByTestId('pickup-input')).toHaveValue(pickup);
  await expect(page.getByTestId('destination-input')).toHaveValue(destination);
  // Restored and ready, but not re-run: a fare from before the reload shown as
  // current is the one thing this product must not do.
  await expect(page.getByTestId('compare-button')).toBeEnabled();
  await expect(page.getByTestId('quote-card')).toHaveCount(0);
});

test('the route never appears in the URL', async ({ page }) => {
  await page.goto('/');
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 30_000 });

  const url = page.url();
  expect(url).not.toMatch(/\d{2}\.\d{4}/); // no coordinates
  expect(url.toLowerCase()).not.toContain('prince');
  expect(url.toLowerCase()).not.toContain('jfk');
});

test('clearing saved places clears the draft too', async ({ page }) => {
  await page.goto('/');
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('clear-places').click();
  await page.reload();
  // Deleting history means deleting it, not leaving a copy in another store.
  await expect(page.getByTestId('pickup-input')).toHaveValue('');
  await expect(page.getByTestId('destination-input')).toHaveValue('');
});

test('a fresh tab starts empty', async ({ browser }) => {
  const ctx = await browser.newContext();
  const first = await ctx.newPage();
  await first.goto('/');
  await fillRoute(first);
  await expect(first.getByTestId('pickup-input')).not.toHaveValue('');

  // sessionStorage is per tab, so a second one shares nothing.
  const second = await ctx.newPage();
  await second.goto('/');
  await expect(second.getByTestId('pickup-input')).toHaveValue('');
  await ctx.close();
});
