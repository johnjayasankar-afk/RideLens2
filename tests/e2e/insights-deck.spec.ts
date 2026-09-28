/**
 * The deck, from the keyboard and from a pointer.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The failure mode a deck has that a stack does not: a panel behind a tab  │
 * │ nobody opened can be blank, broken or missing for weeks and every other  │
 * │ check still passes. The page looks fine. Four fifths of it is one click  │
 * │ away and unverified.                                                     │
 * │                                                                          │
 * │ So every tab gets opened here, and every panel has to put something on   │
 * │ screen. "Something" includes a refusal — several of these panels have    │
 * │ nothing to say under the fixture source, and saying so is the correct    │
 * │ output. What is not allowed is an empty panel.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { expect, test, type Page } from "@playwright/test";

const PICKUP = { lat: 40.7225, lng: -73.9945, formattedAddress: "14 Prince St, New York, NY" };
const DESTINATION = { lat: 40.6446, lng: -73.7797, formattedAddress: "JFK Terminal 4" };
const DEEP_LINK =
  `/?from=${PICKUP.lat},${PICKUP.lng},${encodeURIComponent(PICKUP.formattedAddress)}` +
  `&to=${DESTINATION.lat},${DESTINATION.lng},${encodeURIComponent(DESTINATION.formattedAddress)}`;

const TABS = [
  "Spread",
  "Breakdown",
  "What if",
  "Trade-offs",
  "Timing",
  "Split",
  "Return",
  "No car",
] as const;

async function openComparison(page: Page) {
  await page.goto(DEEP_LINK);
  await expect(page.locator(".quote-card").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".deck")).toBeVisible();
}

test.describe("the insights deck", () => {
  test("offers every analysis behind one strip of tabs", async ({ page }) => {
    await openComparison(page);
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(TABS.length);
    for (const [i, name] of TABS.entries()) {
      await expect(tabs.nth(i)).toHaveText(name);
    }
    /* One selected, and it is the first — nothing starts with no answer up. */
    await expect(page.locator('[role=tab][aria-selected="true"]')).toHaveCount(1);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  });

  test("every panel puts something on screen, including its refusals", async ({ page }) => {
    await openComparison(page);
    for (const name of TABS) {
      await page.getByRole("tab", { name, exact: true }).click();
      const panel = page.locator(".deck-panel:not([hidden])");
      await expect(panel).toHaveCount(1);
      /*
       * A panel that renders nothing is the bug this whole file exists for.
       * Several of these have nothing to report under the fixture source and
       * say so in a sentence; that counts, and a blank does not.
       */
      await expect(panel).toContainText(/\S/, { timeout: 15_000 });
      const text = (await panel.innerText()).trim();
      expect(text.length, `the ${name} panel rendered ${text.length} characters`).toBeGreaterThan(
        20,
      );
      expect(text, `the ${name} panel printed NaN`).not.toContain("NaN");
      expect(text, `the ${name} panel printed undefined`).not.toContain("undefined");
    }
  });

  test("shows exactly one panel at a time and labels it with its tab", async ({ page }) => {
    await openComparison(page);
    await page.getByRole("tab", { name: "Trade-offs" }).click();
    await expect(page.locator(".deck-panel:not([hidden])")).toHaveCount(1);
    await expect(page.locator(".deck-panel:not([hidden])")).toHaveAttribute(
      "aria-labelledby",
      "deck-tab-tradeoffs",
    );
    /* The visited panel stays in the DOM, so going back neither refetches
       nor re-lays-out. It is hidden, not unmounted. */
    await expect(page.locator("#deck-panel-spread")).toHaveAttribute("hidden", "");
  });

  /*
   * Mounting a panel only when it is chosen is the whole reason the forecast
   * can afford to exist; it re-runs the fare engine a few hundred times. If
   * it ever mounts on load, this catches it before the server bill does.
   */
  test("does not load a panel nobody has opened", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/forecast")) asked.push(r.url());
    });
    await openComparison(page);
    await page.waitForTimeout(2500);
    expect(asked, "the forecast loaded without anyone opening Timing").toHaveLength(0);

    await page.getByRole("tab", { name: "Timing" }).click();
    await expect
      .poll(() => asked.length, { timeout: 15_000, message: "choosing Timing did not load it" })
      .toBe(1);

    /* And choosing it twice does not ask twice. */
    await page.getByRole("tab", { name: "Spread" }).click();
    await page.getByRole("tab", { name: "Timing" }).click();
    await page.waitForTimeout(1500);
    expect(asked).toHaveLength(1);
  });

  /*
   * The fetching panels have a loading line long enough to satisfy the
   * "something on screen" check above, so that test would pass on a panel that
   * never resolved. This one watches it settle.
   *
   * What it settles into here is a refusal, and deliberately so: the suite
   * runs on the fixture source with the rate card off (see
   * playwright.config.ts), and the sensitivity endpoint will only re-run fares
   * this engine computed. That is the behaviour under test — the plumbing
   * reaches the endpoint, the endpoint declines, and the panel says why rather
   * than spinning. The chart itself is held to the engine, arm by arm, in
   * tests/unit/sensitivity.test.ts, where no network is involved.
   */
  test("the scenarios settle, and say so when there is nothing to run", async ({ page }) => {
    await openComparison(page);
    await page.getByRole("tab", { name: "What if" }).click();
    const panel = page.locator("#deck-panel-whatif");

    await expect
      .poll(async () => (await panel.innerText()).includes("Re-running"), { timeout: 20_000 })
      .toBe(false);

    const chart = panel.locator(".tor-rows");
    if ((await chart.count()) > 0) {
      await expect(panel.locator(".tor-row")).toHaveCount(4);
      /* The strip it draws has to contain the baseline it draws against —
         the two come from the same clock, or the chart is nonsense. */
      const inside = await panel
        .locator(".tor-band")
        .first()
        .evaluate((band) => {
          const zero = band.parentElement!.querySelector(".tor-zero")!;
          const b = band.getBoundingClientRect();
          const z = zero.getBoundingClientRect();
          return z.left >= b.left - 1 && z.right <= b.right + 1;
        });
      expect(inside, "the card's band did not contain the baseline").toBe(true);
    } else {
      await expect(panel).toContainText(/nothing here is a modeled estimate/i);
    }
    await expect(panel).not.toContainText("NaN");
  });

  test("moves with the arrow keys and keeps focus on the tab it moved to", async ({ page }) => {
    await openComparison(page);
    await page.getByRole("tab", { name: "Spread" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Breakdown" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Breakdown" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "No car" })).toBeFocused();
    /* And does not wrap past the end into nothing. */
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "No car" })).toBeFocused();

    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Spread" })).toBeFocused();
  });

  /* One stop on the way in, then the arrows. The roving tabindex is what
     stops the strip from costing a keyboard user one press per tab. */
  test("takes one tab stop, not one per tab", async ({ page }) => {
    await openComparison(page);
    const tabbable = await page
      .locator('[role=tab][tabindex="0"]')
      .evaluateAll((els) => els.length);
    expect(tabbable).toBe(1);
    expect(await page.locator('[role=tab][tabindex="-1"]').count()).toBe(TABS.length - 1);
  });

  test("fits a phone without pushing the page sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openComparison(page);
    await page.getByRole("tab", { name: "Breakdown" }).click();
    await expect(page.locator(".deck-panel:not([hidden])")).toContainText(/\S/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the deck pushed the page sideways on a phone").toBeLessThanOrEqual(0);
  });
});
