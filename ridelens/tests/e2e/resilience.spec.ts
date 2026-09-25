/** Failure isolation, empty states and location-permission denial. */
import { expect, test, type Page } from '@playwright/test';

async function fillRoute(page: Page) {
  await page.getByTestId('pickup-input').fill('Prince');
  await page.getByRole('option').first().click();
  await page.getByTestId('destination-input').fill('JFK');
  await page.getByRole('option').first().click();
}

test('a partial failure shows the results that arrived and names what did not', async ({
  page,
}) => {
  await page.goto('/');
  // Force the stream to end after the session header: the client must not hang
  // or invent results.
  await page.route('**/api/quotes/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          type: 'session',
          pickup: {
            lat: 40.7233,
            lng: -73.9959,
            formattedAddress: '14 Prince St',
            placeId: null,
            name: '14 Prince St',
            city: 'New York',
            region: 'NY',
            country: 'US',
            geocoder: 'fixture',
          },
          destination: {
            lat: 40.644,
            lng: -73.7823,
            formattedAddress: 'JFK T4',
            placeId: null,
            name: 'JFK Terminal 4',
            city: 'New York',
            region: 'NY',
            country: 'US',
            geocoder: 'fixture',
          },
          straightLineMeters: 20150,
          sourcesExpected: ['obi', 'curb_flow'],
          providersExpected: ['uber', 'lyft', 'empower', 'curb'],
          fixtureBacked: false,
        }) +
        '\n' +
        JSON.stringify({
          type: 'source',
          outcome: {
            sourceId: 'obi',
            status: 'TIMEOUT',
            latencyMs: 8000,
            quoteCount: 0,
            message: 'Request exceeded 8000ms',
            blockerCode: null,
            cacheHit: false,
          },
          quotes: [],
        }) +
        '\n' +
        JSON.stringify({
          type: 'complete',
          session: {
            id: 'qs_test',
            status: 'FAILED',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            pickup: {
              lat: 40.7233,
              lng: -73.9959,
              formattedAddress: '14 Prince St',
              placeId: null,
              name: '14 Prince St',
              city: 'New York',
              region: 'NY',
              country: 'US',
              geocoder: 'fixture',
            },
            destination: {
              lat: 40.644,
              lng: -73.7823,
              formattedAddress: 'JFK T4',
              placeId: null,
              name: 'JFK Terminal 4',
              city: 'New York',
              region: 'NY',
              country: 'US',
              geocoder: 'fixture',
            },
            coverage: {
              sourcesExpected: ['obi'],
              sourcesSucceeded: [],
              sourcesFailed: ['obi'],
              providersReturned: [],
            },
            outcomes: [
              {
                sourceId: 'obi',
                status: 'TIMEOUT',
                latencyMs: 8000,
                quoteCount: 0,
                message: 'Request exceeded 8000ms',
                blockerCode: null,
                cacheHit: false,
              },
            ],
            quotes: [],
            candidates: [],
            discrepancies: [],
          },
        }) +
        '\n',
    });
  });

  await fillRoute(page);
  await page.getByTestId('compare-button').click();

  await expect(page.getByTestId('no-quotes')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('no-quotes')).toContainText(/Nothing is being estimated/i);

  const status = page.getByTestId('source-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText(/Timed out/i);
  // No price is rendered anywhere.
  await expect(page.getByTestId('quote-price')).toHaveCount(0);
});

test('a server error surfaces plainly instead of an empty screen', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/quotes/stream', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'NO_SOURCE_CONFIGURED',
        message: 'No quote source is currently enabled.',
      }),
    }),
  );

  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('session-error')).toBeVisible();
  await expect(page.getByTestId('session-error')).toContainText(/No quote source/i);
});

test('denying location permission leaves search fully usable', async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto('/');

  // The page must not have prompted before any user action.
  await page.getByTestId('use-current-location').click();
  await expect(page.getByText(/Location unavailable/i)).toBeVisible({ timeout: 10_000 });

  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });
});

test('the compare button stays inert until both endpoints are chosen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('compare-button')).toBeDisabled();
  await page.getByTestId('pickup-input').fill('Prince');
  await page.getByRole('option').first().click();
  await expect(page.getByTestId('compare-button')).toBeDisabled();
  await page.getByTestId('destination-input').fill('JFK');
  await page.getByRole('option').first().click();
  await expect(page.getByTestId('compare-button')).toBeEnabled();
});

test('health endpoint reports no live source in the fixture deployment', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.liveDataAvailable).toBe(false);
  expect(body.fixtureSourceActive).toBe(true);
});

test('mobile layout is usable at 390px with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  /*
   * Book CTA is a comfortable tap target.
   *
   * Rounded, because `boundingBox` reports the composited box and a 44px
   * min-height on a fractional device scale comes back as 43.99993896484375.
   * The assertion is about CSS pixels — that is what the guideline is written
   * in and what the style declares — so comparing the raw float made this test
   * fail roughly one run in three for no reason anyone could act on.
   */
  const box = await page.getByTestId('book-button').first().boundingBox();
  expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
});

test('clearing both endpoints starts over, and one does not', async ({ page }) => {
  /*
   * Emptying both fields is an unambiguous "start over". Leaving a priced
   * comparison under two empty fields was the stale half of a route nobody was
   * looking at any more — and it was also the only thing standing between a
   * visitor and the rest of the example trips, which live on the first screen.
   */
  await page.goto('/');
  await fillRoute(page);
  await page.getByTestId('compare-button').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 20_000 });

  // Clearing one end means editing that end, not abandoning the trip.
  await page.getByRole('button', { name: 'Clear pickup' }).click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible();
  await expect(page.getByTestId('empty-state')).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear destination' }).click();
  await expect(page.getByTestId('quote-card')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('example-trips')).toBeVisible();
});
