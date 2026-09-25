import { describe, expect, it } from "vitest";

import {
  confidenceLabel,
  confidenceStep,
  decaySteps,
  decayedConfidence,
  decaysWithAge,
  secondsToNextDecay,
  stepDown,
} from "@/lib/domain/confidence";
import type { NormalizedQuote } from "@/lib/domain/types";

const T0 = new Date("2026-09-25T12:00:00Z");
const at = (secondsLater: number) => new Date(T0.getTime() + secondsLater * 1000);

type QuoteBits = Pick<
  NormalizedQuote,
  "priceType" | "expiresAt" | "receivedAt" | "confidenceClass" | "freshness"
>;

const modeled = (over: Partial<QuoteBits> = {}): QuoteBits => ({
  priceType: "ESTIMATE_RANGE",
  expiresAt: null,
  receivedAt: T0.toISOString(),
  confidenceClass: "MEDIUM",
  freshness: "LIVE",
  ...over,
});

const upfront = (over: Partial<QuoteBits> = {}): QuoteBits => ({
  priceType: "UPFRONT_QUOTE",
  // Held for five minutes.
  expiresAt: at(300).toISOString(),
  receivedAt: T0.toISOString(),
  confidenceClass: "HIGH",
  freshness: "LIVE",
  ...over,
});

describe("the ladder", () => {
  it("steps down without falling off the end", () => {
    expect(stepDown("HIGH", 1)).toBe("MEDIUM");
    expect(stepDown("HIGH", 2)).toBe("LOW");
    expect(stepDown("HIGH", 3)).toBe("UNCERTAIN");
    expect(stepDown("HIGH", 9)).toBe("UNCERTAIN");
    expect(stepDown("LOW", 0)).toBe("LOW");
  });

  it("maps a class to a position, not a percentage", () => {
    expect(confidenceStep("HIGH")).toBe(4);
    expect(confidenceStep("UNCERTAIN")).toBe(1);
  });

  /*
   * The label is the whole public vocabulary for this. It must never contain
   * a number: a percentage reads as a measured frequency, and nothing here
   * has been measured against a real fare yet.
   */
  it("names a class without inventing a number", () => {
    for (const c of ["HIGH", "MEDIUM", "LOW", "UNCERTAIN"] as const) {
      expect(confidenceLabel(c)).not.toMatch(/\d/);
    }
  });
});

describe("what age costs", () => {
  it("leaves a fresh estimate alone", () => {
    const d = decayedConfidence(modeled(), at(10));
    expect(d.class).toBe("MEDIUM");
    expect(d.steps).toBe(0);
    expect(d.reason).toBeNull();
  });

  it("drops a class once conditions have had time to move", () => {
    const d = decayedConfidence(modeled(), at(90));
    expect(d.class).toBe("LOW");
    expect(d.base).toBe("MEDIUM");
    expect(d.reason).toMatch(/moved on/i);
  });

  it("drops two classes by the time it is minutes old", () => {
    const d = decayedConfidence(modeled({ confidenceClass: "HIGH" }), at(200));
    expect(d.class).toBe("LOW");
    expect(d.steps).toBe(2);
  });

  it("bottoms out rather than going negative", () => {
    const d = decayedConfidence(modeled({ confidenceClass: "LOW" }), at(1000));
    expect(d.class).toBe("UNCERTAIN");
  });

  /*
   * Decay can only ever move one way. A test rather than a comment because
   * this is the invariant the whole module exists to hold.
   */
  it("never raises confidence, at any age", () => {
    const ladder = ["UNCERTAIN", "LOW", "MEDIUM", "HIGH"] as const;
    for (const base of ladder) {
      for (const age of [0, 5, 31, 121, 301, 5000]) {
        const d = decayedConfidence(modeled({ confidenceClass: base }), at(age));
        expect(ladder.indexOf(d.class)).toBeLessThanOrEqual(ladder.indexOf(base));
      }
    }
  });
});

describe("a price the provider is holding", () => {
  it("does not decay while it is still valid", () => {
    const d = decayedConfidence(upfront(), at(240));
    expect(d.class).toBe("HIGH");
    expect(d.decays).toBe(false);
    expect(d.reason).toBeNull();
  });

  it("starts decaying the moment the hold lapses", () => {
    expect(decaysWithAge(upfront(), at(299))).toBe(false);
    expect(decaysWithAge(upfront(), at(300))).toBe(true);
  });

  it("treats an upfront quote with no stated validity as a guess", () => {
    // No expiry means nobody is holding anything, whatever it is called.
    expect(decaysWithAge(upfront({ expiresAt: null }), at(0))).toBe(true);
  });

  it("treats an unparseable expiry as no hold at all", () => {
    expect(decaysWithAge(upfront({ expiresAt: "whenever" }), at(0))).toBe(true);
  });

  it("decays every modeled shape", () => {
    for (const t of ["ESTIMATE", "ESTIMATE_RANGE", "METERED_ESTIMATE"] as const) {
      expect(decaysWithAge(modeled({ priceType: t }), at(0))).toBe(true);
    }
  });
});

describe("warning before it gets worse", () => {
  it("counts down to the next drop", () => {
    expect(secondsToNextDecay(modeled(), at(0))).toBe(30);
    expect(secondsToNextDecay(modeled(), at(25))).toBe(5);
    // Past the first threshold, counting to the second.
    expect(secondsToNextDecay(modeled(), at(31))).toBe(89);
  });

  it("says nothing about a price being held", () => {
    expect(secondsToNextDecay(upfront(), at(10))).toBeNull();
  });

  it("says nothing once there is nowhere left to fall", () => {
    expect(secondsToNextDecay(modeled({ confidenceClass: "UNCERTAIN" }), at(0))).toBeNull();
    expect(secondsToNextDecay(modeled(), at(9999))).toBeNull();
  });
});

describe("decaySteps", () => {
  it("maps freshness to classes lost", () => {
    expect(decaySteps("LIVE")).toBe(0);
    expect(decaySteps("RECENT")).toBe(1);
    expect(decaySteps("STALE")).toBe(2);
    expect(decaySteps("EXPIRED")).toBe(3);
  });
});
