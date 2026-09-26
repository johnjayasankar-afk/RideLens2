import { describe, expect, it } from "vitest";

import { describeFailure } from "@/lib/domain/failure-message";

describe("saying what went wrong", () => {
  /*
   * The one that prompted this. A browser's own words are not a thing to
   * show a person, and "Failed to fetch" was reaching the screen verbatim.
   */
  it("translates the browser's fetch failure", () => {
    const m = describeFailure(new TypeError("Failed to fetch"), true);
    expect(m.kind).toBe("unreachable");
    expect(m.title).not.toMatch(/failed to fetch/i);
    expect(m.retryable).toBe(true);
  });

  it("knows being offline is not a server problem", () => {
    const m = describeFailure(new TypeError("Failed to fetch"), false);
    expect(m.kind).toBe("offline");
    // Nothing to retry until the connection is back.
    expect(m.retryable).toBe(false);
  });

  /* The comparison already on screen is usually still useful, and nothing
     was telling anyone that. */
  it("says what is still true while offline", () => {
    expect(describeFailure(null, false).detail).toMatch(/already on screen/i);
  });

  it("separates our fault from theirs", () => {
    const m = describeFailure(new Error("boom"), true, 503);
    expect(m.kind).toBe("server");
    expect(m.detail).toMatch(/our end/i);
  });

  it("recognises a rate limit without guessing at it", () => {
    expect(describeFailure(new Error("x"), true, 429).kind).toBe("rate_limited");
  });

  it("recognises a timeout", () => {
    expect(describeFailure(new Error("The operation timed out"), true).kind).toBe("timeout");
    expect(describeFailure(new DOMException("Aborted", "AbortError"), true).kind).toBe("timeout");
  });

  it("falls back without leaking a stack or a novel", () => {
    const long = "x".repeat(400);
    const m = describeFailure(new Error(long), true);
    expect(m.kind).toBe("unknown");
    expect(m.detail).not.toContain(long);
    expect(m.detail.length).toBeLessThan(120);
  });

  it("keeps a short message that might actually help", () => {
    expect(describeFailure(new Error("Invalid destination"), true).detail).toBe(
      "Invalid destination",
    );
  });

  it("copes with something that is not an error at all", () => {
    expect(describeFailure(undefined, true).kind).toBe("unknown");
    expect(describeFailure("just a string", true).detail).toBe("just a string");
  });

  it("gives every case a title worth reading", () => {
    for (const [err, online, status] of [
      [new TypeError("Failed to fetch"), true, undefined],
      [null, false, undefined],
      [new Error("x"), true, 500],
      [new Error("x"), true, 429],
      [new Error("timed out"), true, undefined],
      [new Error("?"), true, undefined],
    ] as const) {
      const m = describeFailure(err, online, status);
      expect(m.title.length).toBeGreaterThan(8);
      expect(m.title).not.toMatch(/error|undefined|null/i);
    }
  });
});
