/**
 * The deployment origin.
 *
 * `metadataBase` was `NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"` and that
 * variable is not set in the deployment, so `og:image` and `twitter:image`
 * resolved against loopback and every share card on every platform was broken.
 * These tests exist so that cannot ship again.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appOrigin, assertPublicOrigin, isLoopbackOrigin, resetEnvCache } from "@/lib/config";

const KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "NODE_ENV",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  resetEnvCache();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
});

describe("appOrigin", () => {
  it("prefers an explicit app URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ridelens.app";
    expect(appOrigin()).toBe("https://ridelens.app");
  });

  it("falls back to the stable Vercel production host, not the per-deploy one", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ridelens.app";
    process.env.VERCEL_URL = "ridelens-abc123.vercel.app";
    expect(appOrigin()).toBe("https://ridelens.app");
  });

  it("uses the per-deployment host only when nothing better exists", () => {
    process.env.VERCEL_URL = "ridelens-abc123.vercel.app";
    expect(appOrigin()).toBe("https://ridelens-abc123.vercel.app");
  });

  it("adds a scheme to a bare host and keeps only the origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "ridelens.app/compare?x=1";
    expect(appOrigin()).toBe("https://ridelens.app");
  });

  it("ignores blank values rather than treating them as set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ridelens.app";
    expect(appOrigin()).toBe("https://ridelens.app");
  });

  it("falls back to localhost for local development", () => {
    expect(appOrigin()).toBe("http://localhost:3000");
  });
});

describe("isLoopbackOrigin", () => {
  it("recognises every loopback spelling", () => {
    for (const o of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://0.0.0.0:8080",
      "http://[::1]:3000",
    ]) {
      expect(isLoopbackOrigin(o), o).toBe(true);
    }
  });

  it("treats a real host as reachable", () => {
    expect(isLoopbackOrigin("https://ridelens.app")).toBe(false);
  });

  it("treats an unparseable origin as unsafe", () => {
    expect(isLoopbackOrigin("not a url")).toBe(true);
  });
});

describe("assertPublicOrigin", () => {
  /*
   * The regression this whole module exists for: a production build whose
   * absolute URLs point at the reader's own machine.
   */
  it("throws when production metadata would resolve to loopback", () => {
    process.env.NODE_ENV = "production";
    resetEnvCache();
    expect(() => assertPublicOrigin()).toThrow(/resolved to http:\/\/localhost:3000 in production/);
  });

  it("throws when the explicit URL is itself loopback", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000";
    resetEnvCache();
    expect(() => assertPublicOrigin()).toThrow(/in production/);
  });

  it("passes once a reachable origin is configured", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://ridelens.app";
    resetEnvCache();
    expect(() => assertPublicOrigin()).not.toThrow();
  });

  it("stays out of the way in development", () => {
    process.env.NODE_ENV = "development";
    resetEnvCache();
    expect(() => assertPublicOrigin()).not.toThrow();
  });
});
