/**
 * The anonymous compare flow, end to end.
 *
 * The suite runs against the fixture source only — see the note on
 * `webServer.command` in playwright.config.ts for why the rate card is turned
 * off rather than left alongside it.
 */
import { expect, test } from "@playwright/test";

import { MODEL_VERSION } from "@/lib/sources/ratecard/model-params";

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

  /*
   * 390 was the only width checked, and a fourth nav item fitted there while
   * overflowing by 15px at 320 — a width plenty of phones still report. Each
   * page is checked, because the topbar is shared and the pages below it are
   * not.
   */
  for (const width of [320, 360, 390, 414]) {
    for (const path of ["/", "/trips", "/sources"] as const) {
      test(`nothing overflows sideways at ${width}px on ${path}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(path);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }

  /*
   * Two bars are pinned on the results page — the topbar and .sticky-bar —
   * and `html { scroll-padding-top }` reserves for both through --stickies.
   * That reserve is a number in a stylesheet standing in for the height of a
   * bar whose contents are a route summary and a row of buttons, so it is
   * exactly the kind of number that is right on the day it is written and
   * wrong a month later. Under-reserving is the bug it was added to fix:
   * scroll a focused control into view and it lands underneath the toolbar.
   *
   * 900 and 960 are both checked because the bar changes from a row to a
   * stack at 960, and a reserve that is correct on one side of a breakpoint
   * is not evidence about the other.
   */
  for (const width of [390, 900, 960, 1440]) {
    test(`the scroll reserve covers both pinned bars at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        "/?from=40.7225,-73.9945,14%20Prince%20St&to=40.6446,-73.7797,JFK%20Terminal%204",
      );
      await page.waitForSelector(".sticky-bar");
      /*
       * Measure the bar a reader actually scrolls under, not the one that
       * exists for the first four hundred milliseconds.
       *
       * ┌──────────────────────────────────────────────────────────────────┐
       * │ Copy best and Copy all render only once there is a hero and a    │
       * │ ranked list. Until they do, the toolbar is one short row and the │
       * │ bar is 64px at every width; when they land it can wrap, and at   │
       * │ 960–972px it does, to 112px. `waitForSelector(".sticky-bar")`    │
       * │ returns at ~70ms and the quotes arrive at ~400ms, so this        │
       * │ sampled the empty bar on an idle machine and the real one under  │
       * │ load — one assertion measuring two different objects. It passed  │
       * │ roughly two runs in three while a live SC 2.4.11 failure sat     │
       * │ behind it.                                                       │
       * └──────────────────────────────────────────────────────────────────┘
       */
      await page.getByRole("button", { name: "Copy best" }).waitFor({ timeout: 30_000 });

      const { pinned, reserved } = await page.evaluate(() => {
        const topbar = document.querySelector(".topbar")!.getBoundingClientRect().height;
        const bar = document.querySelector(".sticky-bar")!.getBoundingClientRect().height;
        const root = document.documentElement;
        /* --stickies is a calc(); resolve it the way the browser will. */
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;visibility:hidden;height:var(--stickies)";
        root.appendChild(probe);
        const reserved = probe.getBoundingClientRect().height;
        probe.remove();
        return { pinned: topbar + bar, reserved };
      });

      expect(reserved).toBeGreaterThanOrEqual(pinned);
    });
  }

  /*
   * The browser chrome follows the reader's choice, in all six combinations.
   *
   * `viewport.themeColor` in layout.tsx is keyed on `prefers-color-scheme`
   * alone, so a reader on a dark machine who picks Light got a porcelain page
   * under a #0d1511 chrome band — which, with `appleWebApp.capable`, is the
   * iOS standalone status bar at the top of every screen. Two of the six
   * combinations were visibly wrong and only the two *system* ones had ever
   * been looked at.
   */
  for (const os of ["light", "dark"] as const) {
    for (const choice of [null, "light", "dark"] as const) {
      test(`the chrome colour matches the page on a ${os} OS set to ${choice ?? "system"}`, async ({
        browser,
      }) => {
        const ctx = await browser.newContext({ colorScheme: os });
        if (choice) {
          await ctx.addInitScript((c) => localStorage.setItem("ridelens.theme", c), choice);
        }
        const page = await ctx.newPage();
        await page.goto("/");
        await expect(page.locator(".theme-toggle")).toBeVisible();
        /*
         * Two gates on the page being ready, not retries of the assertion.
         *
         * The toggle is server-rendered, so it is on screen well before the
         * effect that owns the meta tag has run. React appends its own copy
         * of `viewport.themeColor` during hydration — measured at ~240ms —
         * and `syncThemeColor` dedupes it in a mount effect. Sampling between
         * those two points sees two tags, which is exactly what this failed
         * on under load and passed on an idle machine.
         *
         * `[data-commands="ready"]` is the page saying its mount effects have
         * run: it comes from a `useSyncExternalStore` whose server snapshot
         * is false, so it flips on the first post-hydration render. And
         * `--ground` is empty until the stylesheet applies — a colour cannot
         * be compared against one the page has not resolved yet.
         */
        await page.waitForSelector('[data-commands="ready"]', { timeout: 30_000 });
        await page.waitForFunction(
          () =>
            getComputedStyle(document.documentElement).getPropertyValue("--ground").trim() !== "",
          null,
          { timeout: 30_000 },
        );

        const { metas, ground } = await page.evaluate(() => ({
          metas: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => ({
            media: (m as HTMLMetaElement).media || null,
            content: (m as HTMLMetaElement).content,
          })),
          ground: getComputedStyle(document.documentElement).getPropertyValue("--ground").trim(),
        }));

        /* One tag, no media attribute, carrying whatever --ground resolved to.
           A media-keyed tag that matches still beats one without, so the
           media-keyed pair has to go rather than be added to. */
        expect(metas).toHaveLength(1);
        expect(metas[0]!.media).toBeNull();
        expect(metas[0]!.content.toLowerCase()).toBe(ground.toLowerCase());
        await ctx.close();
      });
    }
  }

  /*
   * The brand mark is aria-hidden, so the wordmark beside it is the only
   * accessible name the home link has. The narrowest breakpoint clips that
   * text to fit the nav on one line — clipping keeps it, display:none would
   * not, and the difference is a link that announces as "link" to a screen
   * reader.
   */
  test("the home link keeps its name at every width", async ({ page }) => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await expect(page.getByRole("link", { name: "RideLens" }).first()).toBeVisible();
    }
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

/*
 * The command palette.
 *
 * Driven by keyboard throughout, because that is the only way anybody uses
 * it and because the combobox pattern is easy to break without noticing: the
 * highlight moves through aria-activedescendant while focus stays in the
 * input, and a refactor that reaches for a roving tabindex would pass a
 * click-based test and fail a real one.
 */
test.describe("command palette", () => {
  /*
   * The listener is registered on mount, so the shortcut is not answerable
   * the instant the HTML lands. `data-commands="ready"` is the page saying
   * it is — the same signal it uses to decide whether to advertise ⌘K at
   * all. Pressing before it appears is how this suite went flaky on a
   * loaded machine.
   */
  const ready = (page: import("@playwright/test").Page) =>
    page.waitForSelector('[data-commands="ready"]');

  test("opens on the shortcut, filters, runs, and closes", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.keyboard.press("ControlOrMeta+k");

    const palette = page.getByRole("dialog", { name: "Commands" });
    await expect(palette).toBeVisible();

    const input = page.getByRole("combobox", { name: "Type a command" });
    await expect(input).toBeFocused();

    /* The highlight is named by aria-activedescendant, not by focus. */
    await expect(input).toHaveAttribute("aria-activedescendant", /^cmd-/);

    await input.fill("dark");
    const options = page.getByRole("option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText(/Dark/);

    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("escape closes it and returns focus where it was", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    /* Not Swap: it is disabled until both endpoints are set, and a disabled
       button cannot hold the focus this test is about. */
    const anchor = page.getByRole("button", { name: "Use current location" });
    await anchor.focus();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog", { name: "Commands" })).toBeHidden();
    await expect(anchor).toBeFocused();
  });

  test("arrow keys move the highlight without moving focus", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByRole("combobox", { name: "Type a command" });

    const first = await input.getAttribute("aria-activedescendant");
    await page.keyboard.press("ArrowDown");
    const second = await input.getAttribute("aria-activedescendant");

    expect(second).not.toBe(first);
    await expect(input).toBeFocused();
  });
});

/*
 * Price watches.
 *
 * The thing under test is as much the wording as the mechanism. A control
 * that says "watch" beside a price reads as a promise to come and find you,
 * and there is no server polling a route and no channel to send on — so the
 * disclosure has to be present, and it has to say when the check actually
 * happens.
 */
test.describe("price watch", () => {
  const LINK = "/?from=40.7225,-73.9945,14%20Prince%20St&to=40.6446,-73.7797,JFK%20Terminal%204";

  test("sets a threshold, reports when it is met, and survives a reload", async ({ page }) => {
    await page.goto(LINK);
    await page.waitForSelector(".hero-quote");

    await page.getByRole("button", { name: "Tell me when it drops" }).click();

    /* A suggestion, not a saved default — and one the watch has not met. */
    const field = page.getByLabel("Tell me when this trip is at or below");
    await expect(field).toBeFocused();

    await field.fill("999");
    await page.getByRole("button", { name: "Watch", exact: true }).click();

    await expect(page.locator(".watch.met")).toContainText("Under your $999.00 watch");

    await page.reload();
    await page.waitForSelector(".hero-quote");
    await expect(page.locator(".watch.met")).toBeVisible();

    await page.getByRole("button", { name: "Stop watching" }).click();
    await expect(page.getByRole("button", { name: "Tell me when it drops" })).toBeVisible();
  });

  test("never claims it will reach you", async ({ page }) => {
    await page.goto(LINK);
    await page.waitForSelector(".hero-quote");
    await page.getByRole("button", { name: "Tell me when it drops" }).click();

    const disclosure = page.locator(".watch .fine");
    await expect(disclosure).toContainText("when you open RideLens");
    await expect(disclosure).toContainText("background");
    await expect(disclosure).not.toContainText(/notif|alert|push|email/i);
  });
});

/*
 * The trips page.
 *
 * Its content lives in localStorage, so the server renders a shell and the
 * browser fills it. The checks here are about the two things that would be
 * wrong to get wrong: the minimum-sample refusal, and an export that could
 * be mistaken for a receipt.
 */
test.describe("your trips", () => {
  const A = { lat: 40.7225, lng: -73.9945, label: "14 Prince St" };
  const B = { lat: 40.6446, lng: -73.7797, label: "JFK Terminal 4" };
  const KEY = "40.723,-73.994>40.645,-73.780";

  const seed = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      v: 1,
      id: `seed-${i}`,
      at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
      from: A,
      to: B,
      routeKey: KEY,
      miles: 17.9,
      minutes: 33,
      quotes: [
        {
          provider: "curb",
          product: "Curb Taxi",
          lowMinor: 6200 + i * 400,
          highMinor: 6350 + i * 400,
          type: "ESTIMATE_RANGE",
          confidence: "MEDIUM",
        },
      ],
      modelVersion: MODEL_VERSION,
    }));

  test("says so plainly when there is nothing kept", async ({ page }) => {
    await page.goto("/trips");
    await expect(page.locator(".trips-empty")).toContainText("Nothing kept yet");
    await expect(page.locator(".trips-empty")).toContainText("stored on this device");
  });

  test("refuses a range below the minimum, and gives one above it", async ({ page }) => {
    await page.addInitScript((records) => {
      localStorage.setItem("ridelens.trips", JSON.stringify(records));
    }, seed(2));
    await page.goto("/trips");
    await expect(page.locator(".trip-row")).toContainText("Not enough looks");

    await page.addInitScript((records) => {
      localStorage.setItem("ridelens.trips", JSON.stringify(records));
    }, seed(4));
    await page.goto("/trips");
    await expect(page.locator(".trip-row").first()).toContainText("across 4 comparisons");
  });

  test("exports a file that cannot be read as a receipt", async ({ page }) => {
    await page.addInitScript((records) => {
      localStorage.setItem("ridelens.trips", JSON.stringify(records));
    }, seed(3));
    await page.goto("/trips");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV" }).click(),
    ]);

    expect(download.suggestedFilename()).toContain("modeled-estimates");

    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const header = readFileSync(path!, "utf8").split("\n")[0];

    for (const word of ["price", "paid", "fare", "total", "amount"]) {
      expect(header).not.toContain(word);
    }
    expect(header).toContain("estimate_low_usd");
    expect(header).toContain("estimate_high_usd");
    expect(header).toContain("model_version");
  });
});

/*
 * The palette has to be openable without a keyboard.
 *
 * It shipped reachable only by ⌘K, which is to say only by people with a
 * keyboard — a command surface a phone cannot open is a command surface for
 * some of the readers.
 */
test("the command palette can be opened by pointer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForSelector('[data-commands="ready"]');

  await page.getByRole("button", { name: /^Commands/ }).click();
  await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
});

/*
 * The loop that makes the model measurable.
 *
 * `docs/CALIBRATION.md` said "the model has never been measured against a
 * real fare" because the only question that could change that was asked on
 * the handoff page — before the rider had taken the trip. These check it is
 * now asked at a moment somebody can answer, and not before.
 */
test.describe("reporting what a trip cost", () => {
  const A = { lat: 40.7225, lng: -73.9945, label: "14 Prince St" };
  const B = { lat: 40.6446, lng: -73.7797, label: "JFK Terminal 4" };

  const seedChosen = (minutesAgo: number, extra: Record<string, unknown> = {}) => [
    {
      v: 1,
      id: "chosen-1",
      at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      from: A,
      to: B,
      routeKey: "40.723,-73.994>40.645,-73.780",
      miles: 17.9,
      minutes: 33,
      quotes: [
        {
          provider: "curb",
          product: "Curb Taxi",
          lowMinor: 6995,
          highMinor: 7445,
          type: "ESTIMATE_RANGE",
          confidence: "MEDIUM",
        },
      ],
      modelVersion: MODEL_VERSION,
      chosen: {
        quoteId: "curb:taxi",
        provider: "curb",
        product: "Curb Taxi",
        lowMinor: 6995,
        highMinor: 7445,
        at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      },
      ...extra,
    },
  ];

  test("does not ask about a trip that cannot be over yet", async ({ page }) => {
    await page.addInitScript(
      (t) => localStorage.setItem("ridelens.trips", JSON.stringify(t)),
      seedChosen(5),
    );
    await page.goto("/");
    await page.waitForSelector('[data-commands="ready"]');
    await expect(page.locator(".report-outcome")).toHaveCount(0);
  });

  test("asks on the way back, states the estimate, and takes an answer", async ({ page }) => {
    await page.addInitScript(
      (t) => localStorage.setItem("ridelens.trips", JSON.stringify(t)),
      seedChosen(90),
    );
    await page.goto("/");
    await page.waitForSelector('[data-commands="ready"]');

    const ask = page.locator(".report-outcome");
    await expect(ask).toContainText("Curb Taxi");
    /* The prediction is stated before the question, not after. */
    await expect(ask).toContainText("$69.95");
    await expect(ask).toContainText("$74.45");

    await page.getByLabel("What the trip actually cost, in dollars").fill("73.40");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(ask).toHaveCount(0);

    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem("ridelens.trips") || "[]")[0]?.outcome,
    );
    expect(stored.actualMinor).toBe(7340);
    /* Kept on the device: contributing is a separate, explicit act. */
    expect(stored.sharedAt).toBeNull();
  });

  test("never asks twice once skipped", async ({ page }) => {
    /*
     * Seeded only if nothing is there. addInitScript runs on every
     * navigation, so an unconditional write would restore the record on
     * reload and this would be testing the seed rather than the decline.
     */
    await page.addInitScript((t) => {
      if (!localStorage.getItem("ridelens.trips")) {
        localStorage.setItem("ridelens.trips", JSON.stringify(t));
      }
    }, seedChosen(90));
    await page.goto("/");
    await page.waitForSelector('[data-commands="ready"]');
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.locator(".report-outcome")).toHaveCount(0);

    await page.reload();
    await page.waitForSelector('[data-commands="ready"]');
    await expect(page.locator(".report-outcome")).toHaveCount(0);
  });

  test("refuses a statistic below the minimum, and says what it is waiting for", async ({
    page,
  }) => {
    await page.addInitScript(
      (t) => localStorage.setItem("ridelens.trips", JSON.stringify(t)),
      seedChosen(200, {
        outcome: { actualMinor: 7340, at: new Date().toISOString(), sharedAt: "done" },
      }),
    );
    await page.goto("/trips");
    const accuracy = page.locator(".accuracy");
    await expect(accuracy).toContainText("1 of 20");
    await expect(accuracy).toContainText("in band");
    await expect(accuracy).not.toContainText("%");
  });

  /*
   * The handoff used to carry the question. It now says when it will be
   * asked instead, because asking on the way out is what kept the corpus
   * empty.
   */
  test("the handoff no longer asks a question nobody can answer", async ({ page }) => {
    await page.goto("/book?provider=curb&price=%2471.00&pickup=A&destination=B");
    await expect(page.locator('[data-testid="report-actual"]')).toHaveCount(0);
  });
});

/*
 * The assistant.
 *
 * The live answer path needs a real ANTHROPIC_API_KEY, which CI does not
 * have. What is checked here is the behaviour that must hold without one:
 * the surface is absent rather than broken, and the endpoint refuses rather
 * than pretending.
 */
test.describe("the assistant", () => {
  const LINK = "/?from=40.7225,-73.9945,14%20Prince%20St&to=40.6446,-73.7797,JFK%20Terminal%204";

  test("is hidden entirely when it is not configured", async ({ page }) => {
    await page.goto(LINK);
    await page.waitForSelector(".hero-quote");
    await page.waitForTimeout(500);

    const available = await page.evaluate(async () => {
      const res = await fetch("/api/ask");
      return ((await res.json()) as { available: boolean }).available;
    });

    /* A chat box that cannot answer is worse than no chat box. */
    if (!available) {
      await expect(page.locator(".ask-open")).toHaveCount(0);
      await expect(page.locator(".ask")).toHaveCount(0);
    } else {
      await expect(page.locator(".ask-open")).toBeVisible();
    }
  });

  test("refuses to answer rather than failing open", async ({ page }) => {
    await page.goto(LINK);
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "definitely-not-a-session",
          messages: [{ role: "user", content: "what is the price" }],
        }),
      });
      return { status: res.status };
    });
    /* 503 unconfigured, 404 unknown session — never 200 with an invention. */
    expect([404, 503]).toContain(result.status);
  });

  test("rejects a malformed question", async ({ page }) => {
    await page.goto(LINK);
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "x" }),
      });
      return res.status;
    });
    expect([400, 503]).toContain(status);
  });
});

/*
 * The register states a number or it states nothing.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `.console .stat-value` pinned a flat 26px inside an `auto-fit` cell that │
 * │ narrows with the window. `.stat-value` is `nowrap; overflow: hidden;     │
 * │ text-overflow: ellipsis`, so between roughly 970 and 1060 pixels the     │
 * │ best price rendered as `$76.…` and the drive time as `30 mi…`. Five      │
 * │ separate reviews missed it because every one of them worked from a       │
 * │ 1280px frame, and the failure lives in a band no reviewer thought to     │
 * │ open.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * An ellipsis on a price is not a cosmetic defect — it is the instrument
 * reporting a number that is not the number. So the widths below are chosen
 * to sit inside the band that failed rather than at the round sizes a person
 * reaches for, and the assertion is on overflow rather than on appearance:
 * whatever the type scale becomes later, a figure in this register must
 * never be cut.
 */
test.describe("the console register never truncates a figure", () => {
  const LINK = "/?from=40.7225,-73.9945,14%20Prince%20St&to=40.6446,-73.7797,JFK%20Terminal%204";

  for (const width of [1440, 1180, 1056, 1024, 992, 960, 768, 390, 320]) {
    test(`no figure is clipped at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(LINK);
      await page.waitForSelector(".console .stat-value");

      const clipped = await page.$$eval(".console .stat-value", (els) =>
        els
          .map((el) => ({
            text: (el.textContent ?? "").trim(),
            overflow: Math.round((el.scrollWidth - el.clientWidth) * 10) / 10,
          }))
          /* Sub-pixel rounding is not a truncation; a whole pixel is. */
          .filter((r) => r.overflow >= 1),
      );

      expect(clipped, `figures cut off at ${width}px`).toEqual([]);
    });
  }
});
