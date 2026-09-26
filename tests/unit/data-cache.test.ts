import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STALE_WHILE_REVALIDATE_SECONDS,
  TTL_SECONDS,
  cached,
  clearDataCache,
  dataCacheStats,
} from "@/lib/quotes/data-cache";

afterEach(() => {
  clearDataCache();
  vi.useRealTimers();
});

describe("how long each kind of answer lasts", () => {
  /*
   * The ordering is the design. Roads outlast weather by a wide margin, and
   * a price outlasts nothing — see below.
   */
  it("keeps a route far longer than a price", () => {
    expect(TTL_SECONDS.route).toBeGreaterThan(TTL_SECONDS.weather);
    expect(TTL_SECONDS.weather).toBeGreaterThan(TTL_SECONDS.quote);
    expect(TTL_SECONDS.geocode).toBeGreaterThan(TTL_SECONDS.route);
  });

  /*
   * The marketplace ticks on ~55 seconds and the product's whole claim is
   * that the number moves with it. A quote TTL past a tick would serve a
   * price from a tick that has passed while the card says "5 sec ago" —
   * the freshness label lying, which is worse than a slow page.
   */
  it("never lets a price outlive a marketplace tick", () => {
    expect(TTL_SECONDS.quote).toBeLessThan(55);
  });
});

describe("reading through", () => {
  it("loads on a miss and serves the second call from memory", async () => {
    const load = vi.fn(async () => "value");
    const first = await cached("route", "k", load);
    const second = await cached("route", "k", load);

    expect(first.source).toBe("fresh");
    expect(second.source).toBe("hit");
    expect(second.value).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps classes apart, so the same key is two answers", async () => {
    await cached("route", "x", async () => "a-route");
    const w = await cached("weather", "x", async () => "some-weather");
    expect(w.value).toBe("some-weather");
    expect(w.source).toBe("fresh");
  });

  /* Ten concurrent misses should make one request, not ten. */
  it("collapses concurrent misses into one load", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return calls;
    };
    const all = await Promise.all(Array.from({ length: 8 }, () => cached("route", "same", load)));
    expect(calls).toBe(1);
    expect(all.every((r) => r.value === 1)).toBe(true);
  });

  /*
   * A failed OSRM call must not poison the route for six hours. Nothing is
   * written on a throw, so the next caller tries again.
   */
  it("never caches a failure", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("OSRM down"))
      .mockResolvedValueOnce("recovered");

    await expect(cached("route", "flaky", load)).rejects.toThrow("OSRM down");
    const second = await cached("route", "flaky", load);
    expect(second.value).toBe("recovered");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reports what it is holding", async () => {
    await cached("route", "a", async () => 1);
    await cached("weather", "b", async () => 2);
    const stats = dataCacheStats();
    expect(stats.route.size).toBe(1);
    expect(stats.weather.size).toBe(1);
    expect(stats.quote.size).toBe(0);
    expect(stats.route.ttlSeconds).toBe(TTL_SECONDS.route);
  });
});

describe("stale while revalidate", () => {
  /*
   * The distinction that matters. An hour-old route is a distance that was
   * true an hour ago and almost certainly still is — a latency win with no
   * honesty cost. An hour-old price is a fare that has moved.
   */
  it("is offered for routes and refused for prices", () => {
    expect(STALE_WHILE_REVALIDATE_SECONDS.route).toBeGreaterThan(0);
    expect(STALE_WHILE_REVALIDATE_SECONDS.quote).toBe(0);
    expect(STALE_WHILE_REVALIDATE_SECONDS.weather).toBe(0);
  });

  it("answers immediately from a stale route and refreshes behind it", async () => {
    vi.useFakeTimers();
    let n = 0;
    const load = async () => `v${++n}`;

    expect((await cached("route", "r", load)).value).toBe("v1");

    // Past the TTL, inside the revalidate window.
    vi.advanceTimersByTime((TTL_SECONDS.route + 60) * 1000);

    const stale = await cached("route", "r", load);
    expect(stale.source).toBe("stale");
    expect(stale.value).toBe("v1"); // served without waiting

    // The refresh behind it has landed by the next call.
    await vi.waitFor(async () => {
      const next = await cached("route", "r", load);
      expect(next.value).toBe("v2");
    });
  });

  it("makes a price wait rather than serving a stale one", async () => {
    vi.useFakeTimers();
    let n = 0;
    const load = async () => `p${++n}`;

    expect((await cached("quote", "q", load)).value).toBe("p1");
    vi.advanceTimersByTime((TTL_SECONDS.quote + 1) * 1000);

    const again = await cached("quote", "q", load);
    expect(again.source).toBe("fresh");
    expect(again.value).toBe("p2");
  });
});
