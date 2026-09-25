import { defineConfig, devices } from '@playwright/test';

/**
 * The credential-free suite.
 *
 * This is the only test configuration that proves the central claim: RideLens
 * shows a real, live price with nothing configured. So it deliberately does the
 * opposite of the main suite —
 *
 *   • no fixture quote source, no fixture geocoder;
 *   • a PRODUCTION build, where fixtures are structurally impossible;
 *   • real calls to the public geocoder, the public router and the published
 *     rate cards.
 *
 * That makes it slower and genuinely network-dependent, which is the point: a
 * failure here means the out-of-the-box experience is broken, not that a mock
 * drifted.
 */
const PORT = Number(process.env.E2E_LIVE_PORT ?? 3321);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /ratecard\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  // The public geocoder self-throttles to ~1 req/s and can be briefly busy.
  retries: 2,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    // A production build: the strongest possible statement that no fixture is
    // involved, since production refuses to load one.
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_APP_URL: BASE_URL,
      RATE_LIMIT_MAX_REQUESTS: '2000',
    },
  },
});
