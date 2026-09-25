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
   * Deep-link restore, which nothing covered before the state initialisation
   * moved out of a mount effect. The fields used to arrive empty and be filled
   * in a second render; now the URL is read during render, so a shared link
   * paints with its route already in place.
   */
  test("a shared link restores its route, mode and filter", async ({ page }) => {
    const from = `${PICKUP.lat},${PICKUP.lng},${encodeURIComponent(PICKUP.formattedAddress)}`;
    const to = `${DESTINATION.lat},${DESTINATION.lng},${encodeURIComponent(DESTINATION.formattedAddress)}`;
    await page.goto(`/?from=${from}&to=${to}&mode=fastest&filter=XL`);

    await expect(page.getByPlaceholder("Search pickup address")).toHaveValue(/14 Prince St/);
    await expect(page.getByPlaceholder("Search destination")).toHaveValue(/JFK Terminal 4/);
    // And it compares on arrival rather than waiting to be asked.
    await expect(page.locator(".quote-card").first()).toBeVisible({ timeout: 30_000 });
  });

  test("a bare URL opens an empty form and compares nothing", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder("Search pickup address")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Compare rides" })).toBeDisabled();
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

  /** The fixture route as a deep link — no geocoder round-trip to flake on. */
  const DEEP_LINK =
    `/?from=${PICKUP.lat},${PICKUP.lng},${encodeURIComponent(PICKUP.formattedAddress)}` +
    `&to=${DESTINATION.lat},${DESTINATION.lng},${encodeURIComponent(DESTINATION.formattedAddress)}`;

  /*
   * Provenance. The decomposition has always been computed and never shown;
   * these assert that it is on screen and that it reconciles, because a
   * breakdown a reader can add up to the wrong answer is worse than none.
   */
  test("every quote says what kind of number it is", async ({ page }) => {
    await page.goto(DEEP_LINK);
    const cards = page.locator(".quote-card");
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    // Not one card may be without a chip.
    expect(await page.getByTestId("provenance-chip").count()).toBe(await cards.count());
  });

  test("the breakdown opens, reconciles, and closes on Escape", async ({ page }) => {
    await page.goto(DEEP_LINK);
    await expect(page.locator(".quote-card").first()).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("provenance-chip").first().click();
    const sheet = page.getByTestId("provenance-sheet");
    await expect(sheet).toBeVisible();

    /*
     * Two honest shapes. A source that computed the fare itemises it and ends
     * on the figure from the card, so the lines reconcile. A source that
     * handed over a number and no arithmetic — a fixture, or a partner API —
     * says so rather than having a breakdown invented for it.
     */
    const total = sheet.locator(".prov-row-total dd");
    if ((await total.count()) > 0) {
      await expect(total).toBeVisible();
      await expect(total).toHaveText(/\$\d/);
    } else {
      await expect(sheet).toContainText(/nothing to itemise/i);
    }
    // Either way, no value may render as NaN.
    await expect(sheet).not.toContainText("NaN");

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("the sources page never calls an unconfigured source live", async ({ page }) => {
    await page.goto("/sources");
    await expect(
      page.getByRole("heading", { name: /Where every number comes from/i }),
    ).toBeVisible();

    // Every listed source carries a status.
    const rows = page.locator(".source-row");
    expect(await rows.count()).toBeGreaterThan(4);
    expect(await page.locator(".source-status").count()).toBe(await rows.count());

    // Nothing gated behind credentials may claim to be answering.
    const answering = await page
      .locator(".source-row", { has: page.locator(".source-status.is-mint") })
      .locator("h3")
      .allInnerTexts();
    for (const name of answering) {
      expect(name).not.toMatch(/Obi|Uber|Lyft|Curb|Empower/);
    }
  });

  test("the sources page is reachable from the footer", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Where every number comes from/i }).click();
    await expect(page).toHaveURL(/\/sources$/);
  });
});
