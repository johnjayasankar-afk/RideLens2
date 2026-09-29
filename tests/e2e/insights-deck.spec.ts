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

  /*
   * A digit jumps straight to a panel, and the digit is visible on the tab
   * that takes it — revealed on hover or focus, so it is a hint rather than
   * chrome. It lives in a pseudo-element with `content: attr(data-key) / ""`,
   * and that `/ ""` is load-bearing: generated content joins the accessible
   * name, so without it every tab announces as "Spread1" and this file's own
   * name-based selectors stop finding any of them.
   */
  test("takes a digit straight to a panel, without renaming the tab", async ({ page }) => {
    await openComparison(page);
    await page.getByRole("tab", { name: "Spread", exact: true }).focus();
    await page.keyboard.press("3");
    await expect(page.getByRole("tab", { name: "What if", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "What if", exact: true })).toBeFocused();

    await page.keyboard.press("1");
    await expect(page.getByRole("tab", { name: "Spread", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    /* A digit past the last tab is not a tab. */
    await page.keyboard.press("9");
    await expect(page.getByRole("tab", { name: "Spread", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    /* And every tab is still addressable by the name a reader would use. */
    for (const name of TABS) {
      await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(1);
    }
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

  /*
   * The panel lives in the URL so three things can open one: the deck's own
   * tabs, the command palette, and a link somebody was sent. All three go
   * through the same parameter, which is also what makes a reload keep your
   * place.
   */
  test("carries the open panel in the URL, and opens on it", async ({ page }) => {
    await page.goto(`${DEEP_LINK}&panel=whatif`);
    await expect(page.locator(".quote-card").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: "What if" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".deck-panel:not([hidden])")).toHaveAttribute(
      "aria-labelledby",
      "deck-tab-whatif",
    );
  });

  test("writes the panel to the URL when a tab is chosen", async ({ page }) => {
    await openComparison(page);
    await page.getByRole("tab", { name: "Return" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("panel")).toBe("return");

    /* And a reload lands back on it rather than on the first tab. */
    await page.reload();
    await expect(page.getByRole("tab", { name: "Return" })).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 30_000 },
    );
  });

  test("ignores a panel name that is not one", async ({ page }) => {
    await page.goto(`${DEEP_LINK}&panel=../etc/passwd`);
    await expect(page.locator(".quote-card").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: "Spread" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".deck-panel:not([hidden])")).toHaveCount(1);
  });

  test("is reachable from the command palette", async ({ page }) => {
    await openComparison(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".cmdk-item").first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.type("sensitivity");
    const hit = page.locator(".cmdk-item", { hasText: "What if" }).first();
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page.getByRole("tab", { name: "What if" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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

/**
 * The paths that do not scroll.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The suite above opens every tab and asserts every panel says something,  │
 * │ and it passed for months while the Timing panel rendered nothing at all. │
 * │ Playwright's `.click()` scrolls its target into view first — measured,   │
 * │ scrollY 0 → 1835 on desktop — and the forecast was gated on exactly that │
 * │ scroll. The guard and the bug cancelled out.                             │
 * │                                                                          │
 * │ A shared link, a reload on one, and Back are the paths with no scroll in │
 * │ them, and they are what `use-panel.ts` exists to serve. So these never   │
 * │ touch the page: they navigate straight to `?panel=` and read what is     │
 * │ there. A refusal is a pass. An empty box is not.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const PANEL_IDS = [
  "spread",
  "breakdown",
  "whatif",
  "tradeoffs",
  "timing",
  "split",
  "return",
  "transit",
] as const;

test.describe("every panel answers on a deep link, without being scrolled to", () => {
  for (const id of PANEL_IDS) {
    test(`${id} puts something on screen`, async ({ page }) => {
      /*
       * Two of these panels fetch — the forecast re-runs the fare engine a
       * few hundred times server-side — so the budget has to cover a real
       * round trip plus the comparison that precedes it. At the default 30s
       * the test expired at exactly the moment the poll did, and reported the
       * poll rather than the clock.
       */
      test.setTimeout(90_000);
      await page.goto(`${DEEP_LINK}&panel=${id}`);
      await expect(page.locator(".quote-card").first()).toBeVisible({ timeout: 30_000 });

      const panel = page.locator(".deck-panel:not([hidden])");
      await expect(panel).toBeVisible();

      /*
       * The test itself never scrolls, which is the whole point — `.click()`
       * would, and that is how this failure hid for months. (The app does
       * scroll to the results on a phone, which is its own behaviour and not
       * what is under test here.)
       *
       * Polled as one measurement rather than two: an earlier version waited
       * for the text and then sampled the shape in a separate call, and
       * caught mid-render states where the text had landed and the elements
       * had not.
       */
      const ready = () =>
        panel.evaluate((el) => {
          const text = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
          /* Its own furniture does not count as an answer — that is exactly
             what the Timing panel rendered for fifteen seconds while broken. */
          const said = text
            .replace(/Model projection · not a quote|Does waiting help\?/g, "")
            .trim();
          /*
           * One element is enough when that element is a refusal. Under the
           * fixture source the Breakdown panel correctly says "These prices
           * arrived from their sources as totals. There is no arithmetic
           * behind them to take apart", and What-if says a partner's price is
           * theirs to explain — both a single <p>, both the right answer.
           * What the words say is the test; how many boxes carried them is
           * not.
           */
          return el.querySelectorAll("*").length >= 1 && said.length > 20;
        });
      await expect.poll(ready, { timeout: 45_000 }).toBe(true);

      const shape = await panel.evaluate((el) => {
        const text = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
        return {
          elements: el.querySelectorAll("*").length,
          said: text.replace(/Model projection · not a quote|Does waiting help\?/g, "").trim(),
          text,
        };
      });
      expect(shape.elements, `${id} rendered no elements`).toBeGreaterThan(0);
      expect(
        shape.said.length,
        `${id} rendered only its own furniture: "${shape.text}"`,
      ).toBeGreaterThan(20);
    });
  }
});

/**
 * One option on the board is a real state — one tap on a category chip
 * reaches it — and two panels answered it badly: Spread rendered no DOM at
 * all, and What-if announced that the ordering was robust under all eight
 * scenarios, which is a claim about an ordering that does not exist.
 */
test.describe("a board narrowed to a single option", () => {
  for (const id of ["spread", "whatif"] as const) {
    test(`${id} says something true rather than nothing or too much`, async ({ page }) => {
      await page.goto(`${DEEP_LINK}&filter=TAXI&panel=${id}`);
      await expect(page.locator(".quote-card").first()).toBeVisible({ timeout: 30_000 });
      const panel = page.locator(".deck-panel:not([hidden])");

      await expect
        .poll(async () => (await panel.innerText()).trim().length, { timeout: 25_000 })
        .toBeGreaterThan(20);

      const cards = await page.locator(".quote-card").count();
      if (cards > 1) return; // The filter did not narrow to one here.

      const text = (await panel.innerText()).toLowerCase();
      /* Never a robustness claim when there is nothing to be robust about. */
      expect(text).not.toContain("stays the cheapest under all");
      expect(text).not.toContain("not resting on an assumption");
    });
  }
});
