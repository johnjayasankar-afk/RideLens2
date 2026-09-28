import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    /*
     * RIDELENS_ALLOW_FIXTURES, not E2E_TEST: config.ts has no E2E_TEST key, so
     * the old command enabled nothing and every run hit the live rate-card
     * path.
     *
     * RATE_CARD_SOURCE_ENABLED=false because fixtures are ADDED to the enabled
     * sources rather than substituted for them. With the rate card still on,
     * a modeled quote whose price moves with traffic, time of day and weather
     * competes with the fixtures, and "the cheapest is empower" is a coin
     * toss. Turning it off makes the fixture source the only source, which is
     * the only way this assertion can be deterministic.
     */
    /*
     * RATE_LIMIT_MAX_REQUESTS is raised because the whole suite is one IP.
     *
     * The default is 30 compares a minute, which is a sensible ceiling for one
     * caller and a guarantee of failure for ninety-odd tests that each run a
     * comparison from 127.0.0.1 inside ninety seconds. It surfaced when the
     * return-leg panel added a second compare per deck run: a test in the
     * middle of the suite got a rate-limited session, rendered no cards, and
     * failed for a reason that had nothing to do with what it was testing.
     * Passing in isolation and failing in the pack is the signature.
     */
    command:
      "RIDELENS_ALLOW_FIXTURES=true RATE_CARD_SOURCE_ENABLED=false RATE_LIMIT_MAX_REQUESTS=2000 NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 npm run dev -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
