/**
 * The deployment origin.
 *
 * `metadataBase` was `NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"` and that
 * variable is not set in the deployment, so `og:image` and `twitter:image`
 * resolved against loopback and every share card on every platform was broken.
 * These tests exist so that cannot ship again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appOrigin, assertPublicOrigin, isLoopbackOrigin, resetEnvCache } from "@/lib/config";

/*
 * vi.stubEnv rather than assigning process.env directly: NODE_ENV is typed
 * read-only by @types/node, so direct assignment fails `tsc --noEmit` even
 * though vitest runs it happily.
 */
const KEYS = ["NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;

function setEnv(key: string, value: string | undefined) {
  vi.stubEnv(key, value as string);
  resetEnvCache();
}

beforeEach(() => {
  for (const k of KEYS) setEnv(k, undefined);
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("appOrigin", () => {
  it("prefers an explicit app URL", () => {
    setEnv("NEXT_PUBLIC_APP_URL", "https://ridelens.app");
    expect(appOrigin()).toBe("https://ridelens.app");
  });

  it("falls back to the stable Vercel production host, not the per-deploy one", () => {
    setEnv("VERCEL_PROJECT_PRODUCTION_URL", "ridelens.app");
    setEnv("VERCEL_URL", "ridelens-abc123.vercel.app");
    expect(appOrigin()).toBe("https://ridelens.app");
  });

  it("uses the per-deployment host only when nothing better exists", () => {
    setEnv("VERCEL_URL", "ridelens-abc123.vercel.app");
    expect(appOrigin()).toBe("https://ridelens-abc123.vercel.app");
  });

  it("adds a scheme to a bare host and keeps only the origin", () => {
    setEnv("NEXT_PUBLIC_APP_URL", "ridelens.app/compare?x=1");
    expect(appOrigin()).toBe("https://ridelens.app");
  });

  it("ignores blank values rather than treating them as set", () => {
    setEnv("NEXT_PUBLIC_APP_URL", "   ");
    setEnv("VERCEL_PROJECT_PRODUCTION_URL", "ridelens.app");
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
    setEnv("NODE_ENV", "production");
    expect(() => assertPublicOrigin()).toThrow(/resolved to http:\/\/localhost:3000 in production/);
  });

  it("throws when the explicit URL is itself loopback", () => {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    expect(() => assertPublicOrigin()).toThrow(/in production/);
  });

  it("passes once a reachable origin is configured", () => {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PUBLIC_APP_URL", "https://ridelens.app");
    expect(() => assertPublicOrigin()).not.toThrow();
  });

  it("stays out of the way in development", () => {
    setEnv("NODE_ENV", "development");
    expect(() => assertPublicOrigin()).not.toThrow();
  });
});
