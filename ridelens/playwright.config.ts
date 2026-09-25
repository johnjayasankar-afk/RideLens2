import { defineConfig, devices } from '@playwright/test';

/**
 * The deterministic suite.
 *
 * External sources are replaced by the fixture quote source and the fixture
 * geocoder so assertions are stable. Everything else — routing, the NDJSON
 * stream, ranking, reconciliation, the booking allowlist — is the real code
 * path.
 *
 * The credential-free suite lives in `playwright.live.config.ts` and proves
 * the opposite property: that a real price appears with nothing configured.
 */
const PORT = Number(process.env.E2E_PORT ?? 3311);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // The credential-free suite runs under its own config against a production
  // build; it must not pick up this config's fixture server.
  testIgnore: /ratecard\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // A dev server shared across two projects can drop a connection under load;
  // one retry distinguishes that from a real product failure.
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    /**
     * E2E runs against a NON-PRODUCTION server, and that is a deliberate
     * consequence of the product's own safety rail rather than a shortcut:
     * `next start` forces NODE_ENV=production, where `loadConfig` throws on
     * GEOCODER_PROVIDER=fixture and `demoSourceActive` is hard-wired false. A
     * production build genuinely cannot serve fixture data.
     *
     * `npm run build` still runs in `verify:all`, and the live suite exercises
     * a production build directly, so nothing is left unverified.
     */
    command: `npx next dev -p ${PORT}`,
    /**
     * Probe a real endpoint rather than `/`: it only answers once the app has
     * actually compiled, so the first spec cannot race a half-started server.
     * `reuseExistingServer: false` guarantees a clean process — Next permits
     * only one dev server per directory, and a lingering one from a previous
     * run would otherwise be adopted mid-shutdown.
     */
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_APP_URL: BASE_URL,
      RIDELENS_DEMO_SOURCE: 'enabled',
      RIDELENS_E2E: '1',
      GEOCODER_PROVIDER: 'fixture',
      // Every credential-free live source is off here so this suite sees only
      // fixture quotes and stays deterministic. The live suite covers them
      // against a production build, on the real network.
      ENABLE_PUBLIC_RATE_CARD: 'false',
      ENABLE_BIKE_SHARE: 'false',
      ENABLE_REGIONAL_RAIL: 'false',
      // Generous, so a long suite cannot exhaust the autocomplete budget.
      RATE_LIMIT_MAX_REQUESTS: '2000',
    },
  },
});
