/**
 * The journey-time adapter, against a stubbed network and nothing else.
 *
 * Two of these matter more than the rest. `never reaches the network while
 * unconfigured` is the invariant source-contract.test.ts already calls a
 * term-of-service violation waiting for a deploy. `returns null on …` is the
 * whole contract: types.ts:57-61 says a source that guesses is worse than one
 * that declines, so every malformed, slow, broken or empty answer has to come
 * back as an absence rather than an exception or an invention.
 *
 * No test ever lets a real request leave. The credentials are obvious fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/lib/config";
import {
  OtpJourneyTimeSource,
  localDateAndTime,
  shortestItinerarySeconds,
} from "@/lib/transit/journey-time";

const MIDTOWN = { lat: 40.7549, lng: -73.984 };
const JFK = { lat: 40.6413, lng: -73.7781 };
const BASE = "https://transit.land/api/v2/routing";
const KEY = "not-a-real-key-000";

function ok(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

function env(base: string | undefined, key?: string) {
  vi.stubEnv("TRANSIT_ROUTING_BASE_URL", base ?? "");
  vi.stubEnv("TRANSIT_ROUTING_API_KEY", key ?? "");
  resetEnvCache();
}

let source: OtpJourneyTimeSource;

beforeEach(() => {
  source = new OtpJourneyTimeSource();
  env(BASE, KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetEnvCache();
});

describe("with no source configured", () => {
  it("reports itself off and never reaches the network", async () => {
    env(undefined);
    const spy = vi.fn(async () => {
      throw new Error("a dormant adapter called fetch");
    });
    vi.stubGlobal("fetch", spy);

    expect(source.configured()).toBe(false);
    expect(await source.durationSeconds(MIDTOWN, JFK)).toBeNull();
    expect(await source.journey(MIDTOWN, JFK)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays off when the environment itself is unparseable", async () => {
    /* A malformed URL makes envSchema.parse throw. Being misconfigured is
       not the same as crashing a request. */
    env("not-a-url");
    expect(source.configured()).toBe(false);
    expect(await source.durationSeconds(MIDTOWN, JFK)).toBeNull();
  });
});

describe("with a good response", () => {
  it("takes the fastest itinerary the engine returned, and dates it", async () => {
    vi.stubGlobal(
      "fetch",
      ok({ plan: { itineraries: [{ duration: 5046 }, { duration: 3720.4 }] } }),
    );

    const journey = await source.journey(MIDTOWN, JFK);
    expect(journey?.seconds).toBe(3720);
    expect(journey?.label).toBe("Transitland routing");
    expect(journey?.url).toBe("https://www.transit.land/terms");
    expect(Number.isNaN(Date.parse(journey!.measuredAt))).toBe(false);
  });

  it("durationSeconds returns the same number the interface promises", async () => {
    vi.stubGlobal("fetch", ok({ plan: { itineraries: [{ duration: 900 }] } }));
    expect(await source.durationSeconds(MIDTOWN, JFK)).toBe(900);
  });

  it("sends the coordinates, a local date and time, the key, and a deadline", async () => {
    const spy = ok({ plan: { itineraries: [{ duration: 600 }] } });
    vi.stubGlobal("fetch", spy);

    await source.journey(MIDTOWN, JFK);
    const [url, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v2/routing/otp/plan");
    expect(url.searchParams.get("fromPlace")).toBe("40.7549,-73.984");
    expect(url.searchParams.get("toPlace")).toBe("40.6413,-73.7781");
    expect(url.searchParams.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(url.searchParams.get("time")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(url.searchParams.get("api_key")).toBe(KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends no key when there is none — a self-hosted engine has none", async () => {
    env("http://localhost:8080");
    const spy = ok({ plan: { itineraries: [{ duration: 600 }] } });
    vi.stubGlobal("fetch", spy);

    const journey = await source.journey(MIDTOWN, JFK);
    const [url] = spy.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.has("api_key")).toBe(false);
    /* And it does not claim to be Transitland. */
    expect(journey?.label).toBe("Transit routing (localhost)");
    expect(journey?.url).toBeNull();
  });

  it("keeps its own deadline when a caller also passes a signal", async () => {
    const spy = ok({ plan: { itineraries: [{ duration: 600 }] } });
    vi.stubGlobal("fetch", spy);

    const controller = new AbortController();
    await source.journey(MIDTOWN, JFK, controller.signal);
    const init = (spy.mock.calls[0] as unknown as [URL, RequestInit])[1];
    controller.abort();
    expect(init.signal!.aborted).toBe(true);
  });
});

describe("every way it can fail", () => {
  const cases: Array<[string, () => void]> = [
    [
      "an HTTP 500",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => new Response("no", { status: 500 })),
        ),
    ],
    [
      "a 429 over quota",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => new Response("slow down", { status: 429 })),
        ),
    ],
    [
      "a 401 from a bad key",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => new Response("nope", { status: 401 })),
        ),
    ],
    [
      "a body that is not JSON",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => new Response("<html>", { status: 200 })),
        ),
    ],
    [
      "no route found",
      () => vi.stubGlobal("fetch", ok({ error: { id: 404, msg: "PATH_NOT_FOUND" } })),
    ],
    ["an empty itinerary list", () => vi.stubGlobal("fetch", ok({ plan: { itineraries: [] } }))],
    [
      "a duration sent as a string",
      () => vi.stubGlobal("fetch", ok({ plan: { itineraries: [{ duration: "3720" }] } })),
    ],
    [
      "a duration of NaN",
      () => vi.stubGlobal("fetch", ok({ plan: { itineraries: [{ duration: Number.NaN }] } })),
    ],
    [
      "a negative duration",
      () => vi.stubGlobal("fetch", ok({ plan: { itineraries: [{ duration: -60 }] } })),
    ],
    [
      "a duration longer than a day",
      () => vi.stubGlobal("fetch", ok({ plan: { itineraries: [{ duration: 25 * 3600 }] } })),
    ],
    [
      "junk inside the itinerary list",
      () => vi.stubGlobal("fetch", ok({ plan: { itineraries: [null, "x", 7] } })),
    ],
    [
      "a timeout",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
          }),
        ),
    ],
    [
      "a network error",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new TypeError("fetch failed");
          }),
        ),
    ],
  ];

  for (const [name, arrange] of cases) {
    it(`returns null on ${name}, and does not throw`, async () => {
      arrange();
      await expect(source.durationSeconds(MIDTOWN, JFK)).resolves.toBeNull();
      await expect(source.journey(MIDTOWN, JFK)).resolves.toBeNull();
    });
  }
});

describe("the parser on its own", () => {
  it("reads both published shapes", () => {
    /* Transitland and OTP nest under `plan`; MOTIS does not. */
    expect(shortestItinerarySeconds({ plan: { itineraries: [{ duration: 900 }] } })).toBe(900);
    expect(shortestItinerarySeconds({ itineraries: [{ duration: 900 }, { duration: 840 }] })).toBe(
      840,
    );
  });

  it("declines everything that is not one of them", () => {
    const nothing = [
      null,
      undefined,
      0,
      "",
      [],
      {},
      { plan: null },
      { plan: {} },
      { plan: { itineraries: "no" } },
      { itineraries: "no" },
    ];
    for (const body of nothing) expect(shortestItinerarySeconds(body)).toBeNull();
  });
});

describe("the local clock", () => {
  it("formats New York wall-clock time, not the server's", () => {
    /* 02:30Z on the 15th is 21:30 on the 14th in New York. */
    expect(localDateAndTime(new Date("2026-01-15T02:30:00Z"))).toEqual({
      date: "2026-01-14",
      time: "21:30:00",
    });
  });

  it("writes midnight as 00, not 24", () => {
    /* hour12:false renders 24 on some ICU builds, which OTP rejects. */
    expect(localDateAndTime(new Date("2026-01-15T05:00:00Z")).time).toBe("00:00:00");
  });
});
