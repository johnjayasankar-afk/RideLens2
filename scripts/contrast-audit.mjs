/**
 * Contrast audit across every scheme combination.
 *
 * `node scripts/contrast-audit.mjs [url]` against a running build.
 *
 * Resolves a gradient background rather than walking past it. The earlier
 * ad-hoc version reported the primary and booking buttons as 1.0:1 in every
 * run — they are white on a dark-green gradient — and a report with four
 * standing false positives is a report nobody reads.
 */
import { chromium } from "@playwright/test";

const URL =
  process.argv[2] ??
  "http://localhost:3000/?from=40.7549,-73.9840,A&to=40.6413,-73.7781,B&filter=ALL";

const AUDIT = () => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  };
  /* A gradient is a background too. Take its first opaque stop. */
  const fromGradient = (cs) => {
    const bi = cs.backgroundImage;
    if (!bi || bi === "none") return null;
    for (const m of bi.matchAll(/rgba?\([^)]+\)/g)) {
      const c = parse(m[0]);
      if (c && c.a > 0.75) return c.rgb;
    }
    return null;
  };
  const bgOf = (el) => {
    let e = el;
    while (e) {
      const cs = getComputedStyle(e);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0.75) return c.rgb;
      const g = fromGradient(cs);
      if (g) return g;
      e = e.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor)?.rgb ?? [255, 255, 255];
  };

  const fails = [];
  for (const el of document.querySelectorAll("*")) {
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.1)
      continue;
    /* Third-party widgets we do not author the internals of. */
    if ((el.className?.toString?.() || "").includes("maplibregl")) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight) || 400;
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const bg = bgOf(el);
    const L1 = lum(fg.rgb);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (ratio < need)
      fails.push({
        text: el.textContent.trim().slice(0, 26),
        cls: (el.className?.toString?.() || el.tagName.toLowerCase()).slice(0, 28),
        ratio: +ratio.toFixed(2),
        need,
      });
  }
  return fails;
};

const browser = await chromium.launch();
let total = 0;

for (const os of ["light", "dark"]) {
  for (const choice of [null, "light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      colorScheme: os,
    });
    const page = await ctx.newPage();
    if (choice) await page.addInitScript((c) => localStorage.setItem("ridelens.theme", c), choice);
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForSelector(".quote-card", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const fails = await page.evaluate(AUDIT);
    total += fails.length;
    const label = `OS ${os.padEnd(5)} choice ${String(choice ?? "system").padEnd(6)}`;
    console.log(`${label} ${fails.length === 0 ? "ok" : `${fails.length} FAIL`}`);
    for (const f of fails.slice(0, 8)) {
      console.log(`   ${String(f.ratio).padStart(5)}:1 (needs ${f.need})  ${f.cls}  "${f.text}"`);
    }
    await ctx.close();
  }
}

await browser.close();
if (total > 0) {
  console.error(`\n${total} contrast failures. Pick the token for the job — see docs/A11Y.md.`);
  process.exit(1);
}
console.log("\nEvery scheme combination clears WCAG 2.2 AA.");
