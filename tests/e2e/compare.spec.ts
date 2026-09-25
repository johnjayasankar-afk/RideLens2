/**
 * The anonymous compare flow, end to end.
 *
 * The suite runs against the fixture source only — see the note on
 * `webServer.command` in playwright.config.ts for why the rate card is turned
 * off rather than left alongside it.
 */
import { expect, test } from "@playwright/test";

/** 14 Prince St → JFK Terminal 4, the pair the fixtures are written around. */
const PICKUP = {
  lat: 40.7225,
  lng: -73.9945,
  formattedAddress: "14 Prince St, New York, NY",
};
const DESTINATION = {
  lat: 40.6446,
  lng: -73.7797,
  formattedAddress: "JFK Terminal 4",
};

test.describe("RideLens anonymous flow", () => {
  test("home renders and compare is disabled until both endpoints are set", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "RideLens" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare rides" })).toBeDisabled();
  });

  /*
   * Asserted through the API rather than the form: picking a place requires a
   * live geocoder round-trip, and a test that depends on Nominatim answering
   * is a test that fails for reasons that have nothing to do with RideLens.
   * The form path is covered by the disabled-button check above.
   */
  test("a fixture comparison ranks the cheapest fixture first", async ({ request }) => {
    const res = await request.post("/api/quotes", {
      data: { pickup: PICKUP, destination: DESTINATION, stream: false },
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const quotes = body.session.quotes as Array<{
      provider: string;
      priceMinMinor: number;
      priceMaxMinor: number;
    }>;
    expect(quotes.length).toBeGreaterThan(0);

    // Empower at $23.84 is the cheapest fixture, and with the rate card off it
    // is the cheapest full stop.
    expect(quotes[0]!.provider).toBe("empower");
    expect(quotes[0]!.priceMinMinor).toBe(2384);

    // The ranking is genuinely ordered, not merely correct at the head.
    const heads = quotes.map((q) => q.priceMinMinor);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });

  test("every quote carries the semantics the UI depends on", async ({ request }) => {
    const res = await request.post("/api/quotes", {
      data: { pickup: PICKUP, destination: DESTINATION, stream: false },
    });
    const body = await res.json();
    for (const q of body.session.quotes) {
      expect(q.priceType, `${q.provider} priceType`).toBeTruthy();
      expect(q.confidenceClass, `${q.provider} confidenceClass`).toBeTruthy();
      expect(q.priceMaxMinor).toBeGreaterThanOrEqual(q.priceMinMinor);
      // A range must never be presented as an exact figure.
      if (q.priceType === "ESTIMATE_RANGE") {
        expect(q.priceMaxMinor).toBeGreaterThan(q.priceMinMinor);
      }
    }
  });

  test("health reports which sources are actually live", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.app).toBe("ridelens");
    // The suite runs on fixtures alone, and health must say so rather than
    // implying a partner source is answering.
    expect(body.sources.fixtures).toBe("enabled_non_prod");
    expect(body.sources.public_rate_card).toBe("disabled");
    // Nothing gated behind partner credentials may report itself as enabled.
    for (const key of ["uber", "lyft", "curb", "empower", "obi"] as const) {
      expect(String(body.sources[key]), key).not.toBe("enabled");
    }
  });

  /*
   * The tagline lives in the document title and the OG image; it is not
   * rendered into the page. The old assertion looked for it as visible text,
   * and for a string ("One live comparison") that appears nowhere in the
   * codebase — so it could never have passed.
   */
  test("mobile viewport renders the comparison form", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page).toHaveTitle(/Every ride\. One comparison\./);
    await expect(page.getByRole("button", { name: "Compare rides" })).toBeVisible();
    // Nothing may overflow the viewport sideways on a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
