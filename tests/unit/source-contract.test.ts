/**
 * The contract every quote source owes, tested against the five that are off.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Five adapters — Obi, Lyft, Curb, Empower, Uber — ship dormant. Nothing   │
 * │ exercises them, so nothing notices when one rots: a renamed env var, a   │
 * │ thrown error where a typed failure belongs, a fetch that fires before    │
 * │ the credential check. The first anyone would learn of it is the day a    │
 * │ partner deal closes and the adapter is switched on in production.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Two of these tests matter more than the rest.
 *
 * `makes no network call while dormant` is the one that protects a partner
 * relationship. An adapter that reaches an endpoint before checking whether it
 * is allowed to is a term-of-service violation waiting for a deploy.
 *
 * `no partner source turns itself on` is the standing rule of this codebase —
 * *ask before enabling any partner source* — written down somewhere a machine
 * can check it. A default that quietly flips is exactly the failure a written
 * rule does not catch.
 *
 * None of this enables anything. Credentials here are obvious fakes, fetch is
 * stubbed to throw, and no test ever lets a real request leave.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/lib/config";
import type { QuoteRequest } from "@/lib/domain/types";
import { CurbFlowQuoteSource } from "@/lib/sources/curb/curb-flow-quote-source";
import { EmpowerAuthorizedQuoteSource } from "@/lib/sources/empower/empower-authorized-quote-source";
import { LyftAuthorizedQuoteSource } from "@/lib/sources/lyft/lyft-authorized-quote-source";
import { ObiQuoteSource } from "@/lib/sources/obi/obi-quote-source";
import { UberAuthorizedQuoteSource } from "@/lib/sources/uber/uber-authorized-quote-source";
import type { QuoteSource } from "@/lib/sources/types";

const REQUEST: QuoteRequest = {
  pickup: { lat: 40.7549, lng: -73.984, formattedAddress: "Midtown" },
  destination: { lat: 40.6413, lng: -73.7781, formattedAddress: "JFK" },
} as QuoteRequest;

/** Every environment variable that could wake one of these up. */
const PARTNER_VARS = [
  "OBI_API_KEY",
  "OBI_API_SECRET",
  "OBI_API_BASE_URL",
  "LYFT_CLIENT_ID",
  "LYFT_CLIENT_SECRET",
  "LYFT_COMPARISON_AUTHORIZED",
  "CURB_API_KEY",
  "CURB_API_BASE_URL",
  "EMPOWER_API_KEY",
  "EMPOWER_API_BASE_URL",
  "UBER_CLIENT_ID",
  "UBER_CLIENT_SECRET",
  "UBER_COMPARISON_AUTHORIZED",
] as const;

function silenceAllPartners() {
  for (const v of PARTNER_VARS) vi.stubEnv(v, "");
  resetEnvCache();
}

/** Fails the test rather than the request, and names who reached out. */
function forbidNetwork() {
  const spy = vi.fn(async (input: unknown) => {
    throw new Error(`a dormant adapter called fetch: ${String(input)}`);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ADAPTERS: Array<{ name: string; make: () => QuoteSource }> = [
  { name: "obi", make: () => new ObiQuoteSource() },
  { name: "lyft", make: () => new LyftAuthorizedQuoteSource() },
  { name: "curb", make: () => new CurbFlowQuoteSource() },
  { name: "empower", make: () => new EmpowerAuthorizedQuoteSource() },
  { name: "uber", make: () => new UberAuthorizedQuoteSource() },
];

beforeEach(() => {
  silenceAllPartners();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

describe.each(ADAPTERS)("$name, while dormant", ({ make }) => {
  it("has a stable id", () => {
    expect(make().id).toMatch(/^[a-z][a-z0-9_]*$/);
    // Constructing twice must not produce two identities.
    expect(make().id).toBe(make().id);
  });

  it("describes itself without throwing, and claims no comparison right", () => {
    const caps = make().capabilities();
    expect(caps.comparisonPermitted).toBe(false);
    expect(caps.supportsPrice).toBe(false);
    expect(Array.isArray(caps.markets)).toBe(true);
    expect(caps.ttlSeconds).toBeGreaterThan(0);
  });

  it("reports its health as not-live, and says why", async () => {
    const health = await make().healthCheck();
    expect(["disabled", "misconfigured", "down"]).toContain(health.status);
    expect(health.lastError).toBeTruthy();
    // A source that is off cannot be surfacing anybody.
    expect(health.providersSurfaced).toEqual([]);
  });

  /*
   * The important one. An adapter that reaches an endpoint before checking
   * whether it is allowed to is a terms violation one deploy away.
   */
  it("makes no network call while dormant", async () => {
    const fetchSpy = forbidNetwork();
    const source = make();

    source.capabilities();
    await source.healthCheck();
    await source.getQuotes(REQUEST);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /*
   * Failing is fine. Throwing is not: the orchestrator collects failures to
   * show on /sources, and an exception escaping one adapter takes the whole
   * comparison down with it.
   */
  it("fails as data rather than as an exception", async () => {
    forbidNetwork();
    const result = await make().getQuotes(REQUEST);

    expect(result.ok).toBe(false);
    expect(result.quotes).toEqual([]);
    expect(result.failure).toBeDefined();
    expect(result.failure!.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(result.failure!.message.length).toBeGreaterThan(10);
    // Missing credentials will not fix themselves on a retry.
    expect(result.failure!.retryable).toBe(false);
    expect(result.failure!.sourceId).toBe(make().id);
    expect(Number.isFinite(result.latencyMs)).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  /*
   * A dormant source returns no quotes, so it cannot be the thing that
   * invents one. Stated as its own assertion because the day this breaks is
   * the day the product shows a fabricated partner price.
   */
  it("invents nothing", async () => {
    forbidNetwork();
    const result = await make().getQuotes(REQUEST);
    expect(result.quotes).toHaveLength(0);
  });
});

describe("secrets", () => {
  /*
   * Half-configured is the realistic leak: credentials present, the endpoint
   * unreachable, and the error message built by interpolating the URL that
   * was being called. Keys travel in query strings often enough that this is
   * worth a test rather than a code review.
   */
  const SECRET = "sk-live-NEVER-PRINT-THIS-0123456789";

  it("never puts a credential in anything a caller can read", async () => {
    vi.stubEnv("CURB_API_KEY", SECRET);
    vi.stubEnv("CURB_API_BASE_URL", `https://curb.invalid/?key=${SECRET}`);
    vi.stubEnv("EMPOWER_API_KEY", SECRET);
    vi.stubEnv("EMPOWER_API_BASE_URL", `https://empower.invalid/?key=${SECRET}`);
    vi.stubEnv("OBI_API_KEY", SECRET);
    vi.stubEnv("OBI_API_SECRET", SECRET);
    resetEnvCache();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );

    for (const make of [
      () => new CurbFlowQuoteSource(),
      () => new EmpowerAuthorizedQuoteSource(),
      () => new ObiQuoteSource(),
    ]) {
      const source = make();
      const seen = JSON.stringify({
        caps: source.capabilities(),
        health: await source.healthCheck(),
        quotes: await source.getQuotes(REQUEST),
      });
      expect(seen).not.toContain(SECRET);
    }
  });
});

describe("the registry", () => {
  /*
   * The standing rule of this codebase, made mechanical: *ask before
   * enabling any partner source*. A written rule does not catch a default
   * that quietly flips; this does.
   */
  it("turns no partner source on by itself", async () => {
    silenceAllPartners();
    const { discoverEnabledSources } = await import("@/lib/sources/registry");
    const ids = discoverEnabledSources().map((s) => s.id);

    for (const partner of [
      "obi",
      "lyft_authorized",
      "curb_flow",
      "empower_authorized",
      "uber_authorized",
    ]) {
      expect(ids).not.toContain(partner);
    }
  });

  it("still lists the dormant ones, so /sources can account for them", async () => {
    const { listAllSources } = await import("@/lib/sources/registry");
    const ids = listAllSources().map((s) => s.id);
    for (const partner of [
      "obi",
      "lyft_authorized",
      "curb_flow",
      "empower_authorized",
      "uber_authorized",
    ]) {
      expect(ids).toContain(partner);
    }
  });

  it("gives every source a distinct id", async () => {
    const { listAllSources } = await import("@/lib/sources/registry");
    const ids = listAllSources().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never summarises a dormant partner as enabled", async () => {
    silenceAllPartners();
    const { sourceStatusSummary } = await import("@/lib/sources/registry");
    const summary = sourceStatusSummary();
    for (const key of ["obi", "lyft", "curb", "empower", "uber"] as const) {
      expect(summary[key]).not.toBe("enabled");
    }
  });
});
