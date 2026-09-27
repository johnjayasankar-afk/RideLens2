/**
 * Does every endpoint have a ceiling?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `/api/walk` fans out to a public walking router — somebody else's        │
 * │ server — and shipped with no rate limit at all. The file's own header    │
 * │ argues that sixteen speculative queries per comparison is not a          │
 * │ reasonable thing to send it, and then left the number of comparisons     │
 * │ unbounded. `/api/alternatives` was the same. Every endpoint written      │
 * │ before them had a limit; the three added later did not, and nothing      │
 * │ noticed.                                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A limit is cheap to add and invisible to forget, which is the combination
 * that makes it worth a test rather than a convention. Exemptions are listed
 * with their reason, and the list is exact in both directions.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const API_DIR = "src/app/api";

/**
 * Endpoints that may answer without a per-IP ceiling, and why.
 *
 * Nothing that reaches outward, spends money, or writes belongs here.
 */
const EXEMPT: Record<string, string> = {
  "health/route.ts":
    "A liveness probe. Rate-limiting it means an orchestrator can be told the service is down because it asked too often.",
  "admin/overview/route.ts": "Behind RIDELENS_ADMIN_SECRET, and returns 401 before doing any work.",
  "quotes/[id]/route.ts":
    "Reads one already-computed session by an unguessable id. No outbound call, no computation, no write.",
};

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const routes = routeFiles(API_DIR).map((path) => ({
  path,
  rel: path.slice(API_DIR.length + 1),
  source: readFileSync(path, "utf8"),
}));

const limited = (source: string) => /\brateLimit\s*\(/.test(source);

describe("every API route", () => {
  it("was found", () => {
    expect(routes.length).toBeGreaterThan(8);
  });

  it("has a rate limit, or a stated reason not to", () => {
    const unguarded = routes
      .filter((r) => !limited(r.source) && !(r.rel in EXEMPT))
      .map((r) => r.rel);
    expect(
      unguarded,
      unguarded.length === 0
        ? ""
        : `\n\nThese endpoints answer without a per-IP ceiling:\n` +
            unguarded.map((r) => `  ${r}`).join("\n") +
            `\n\nAdd rateLimit(), or add the route to EXEMPT with the reason it is safe` +
            ` without one. Anything that reaches outward, spends money or writes is not.\n`,
    ).toEqual([]);
  });

  /* So the exemption list cannot quietly stop describing the code. */
  it("keeps the exemption list honest", () => {
    const stale = Object.keys(EXEMPT).filter((rel) => !routes.some((r) => r.rel === rel));
    expect(stale, `EXEMPT names routes that no longer exist: ${stale.join(", ")}`).toEqual([]);

    const nowLimited = Object.keys(EXEMPT).filter((rel) =>
      routes.some((r) => r.rel === rel && limited(r.source)),
    );
    expect(
      nowLimited,
      `These are exempt but now rate-limited anyway — strike them off: ${nowLimited.join(", ")}`,
    ).toEqual([]);
  });

  /*
   * The ones that spend someone else's capacity are the reason this file
   * exists, so they are named rather than left to the general rule.
   */
  it("limits the endpoints that reach outward", () => {
    for (const rel of ["walk/route.ts", "alternatives/route.ts", "route/route.ts"]) {
      const route = routes.find((r) => r.rel === rel);
      expect(route, `${rel} is missing`).toBeDefined();
      expect(limited(route!.source), `${rel} makes outbound calls without a ceiling`).toBe(true);
    }
  });

  it("answers a refusal with 429 and something to wait for", () => {
    for (const route of routes.filter((r) => limited(r.source))) {
      expect(route.source, `${route.rel} rate-limits but never returns 429`).toMatch(/429/);
    }
  });
});
