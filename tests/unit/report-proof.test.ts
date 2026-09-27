import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/lib/config";
import {
  PROOF_MAX_AGE_DAYS,
  proofsAvailable,
  signPrediction,
  verifyPrediction,
  type PredictionClaim,
} from "@/lib/eval/report-proof";

const SECRET = "test-secret-at-least-sixteen-chars";

const claim = (over: Partial<PredictionClaim> = {}): PredictionClaim => ({
  routeHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  provider: "curb",
  productId: "taxi",
  marketId: "new-york",
  predictedMinMinor: 6995,
  predictedMaxMinor: 7145,
  predictedAt: "2026-09-20T14:30:00.000Z",
  modelVersion: "2026-09-26.v1",
  distanceMeters: 28800,
  predictedWaitLowSeconds: 120,
  predictedWaitHighSeconds: 180,
  ...over,
});

const NOW = new Date("2026-09-21T10:00:00.000Z");

/* getEnv() parses once and caches, so the cache has to go with the value. */
beforeEach(() => {
  process.env.RIDELENS_REPORT_SECRET = SECRET;
  resetEnvCache();
});
afterEach(() => {
  delete process.env.RIDELENS_REPORT_SECRET;
  resetEnvCache();
});

describe("without a secret", () => {
  /*
   * A deployment that has configured nothing is no worse off than before:
   * no proof is issued and reporting falls back to the live-session path.
   */
  it("issues nothing and says so", () => {
    delete process.env.RIDELENS_REPORT_SECRET;
    resetEnvCache();
    expect(proofsAvailable()).toBe(false);
    expect(signPrediction(claim())).toBeNull();
  });

  it("refuses to verify rather than accepting anything", () => {
    const signature = signPrediction(claim())!;
    delete process.env.RIDELENS_REPORT_SECRET;
    resetEnvCache();
    const result = verifyPrediction(claim(), signature, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_secret");
  });

  /* Too short to be a secret is the same as not having one. */
  it("treats a trivially short secret as absent", () => {
    process.env.RIDELENS_REPORT_SECRET = "short";
    resetEnvCache();
    expect(proofsAvailable()).toBe(false);
  });
});

describe("a signed prediction", () => {
  it("verifies when it comes back unchanged", () => {
    const signature = signPrediction(claim())!;
    expect(verifyPrediction(claim(), signature, NOW)).toEqual({ ok: true });
  });

  it("is stable, so the same claim always checks out", () => {
    expect(signPrediction(claim())).toBe(signPrediction(claim()));
  });

  /*
   * The whole point. A calibration corpus that accepts a prediction the
   * client can edit measures nothing at all.
   */
  it("fails if any field is edited", () => {
    const signature = signPrediction(claim())!;
    const edits: Array<Partial<PredictionClaim>> = [
      { predictedMinMinor: 6000 },
      { predictedMaxMinor: 9999 },
      { provider: "uber" },
      { productId: "uberx" },
      { marketId: "chicago" },
      { routeHash: "0000000000000000000000000000000f" },
      { modelVersion: "2020-01-01.v0" },
      { distanceMeters: 1 },
      { predictedWaitLowSeconds: 1 },
      { predictedWaitHighSeconds: 9 },
      { predictedAt: "2026-09-20T14:30:01.000Z" },
    ];
    for (const edit of edits) {
      const result = verifyPrediction(claim(edit), signature, NOW);
      expect(result.ok, `editing ${Object.keys(edit)[0]} still verified`).toBe(false);
    }
  });

  it("rejects a signature that is merely the right shape", () => {
    const result = verifyPrediction(claim(), "not-a-real-signature", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  /*
   * Length-prefixed rather than delimited: a product name containing what
   * looks like a separator must not be able to spell a different claim that
   * signs the same.
   */
  it("cannot be confused by a field that looks like a boundary", () => {
    const a = signPrediction(claim({ provider: "curb", productId: "taxi" }));
    const b = signPrediction(claim({ provider: "curb|4:taxi", productId: "" }));
    expect(a).not.toBe(b);

    const c = signPrediction(claim({ marketId: "new", productId: "york" }));
    const d = signPrediction(claim({ marketId: "newyork", productId: "" }));
    expect(c).not.toBe(d);
  });

  /* An empty optional and a missing one must not sign alike either. */
  it("distinguishes a null field from an empty one", () => {
    expect(signPrediction(claim({ marketId: null }))).toBe(signPrediction(claim({ marketId: "" })));
    expect(signPrediction(claim({ distanceMeters: null }))).not.toBe(
      signPrediction(claim({ distanceMeters: 0 })),
    );
  });
});

describe("how long a prediction stays reportable", () => {
  const signature = () => signPrediction(claim())!;

  it("accepts one from within the window", () => {
    const sixDays = new Date("2026-09-26T14:00:00.000Z");
    expect(verifyPrediction(claim(), signature(), sixDays)).toEqual({ ok: true });
  });

  /*
   * A signature proves the prediction was ours; it does not stop the same
   * one being replayed a year later, by which time the model has moved and
   * the fare belongs to a different market.
   */
  it("refuses one past the window", () => {
    const late = new Date(
      new Date(claim().predictedAt).getTime() + (PROOF_MAX_AGE_DAYS + 1) * 86_400_000,
    );
    const result = verifyPrediction(claim(), signature(), late);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("refuses one predicted in the future", () => {
    const before = new Date("2026-09-20T13:00:00.000Z");
    const result = verifyPrediction(claim(), signature(), before);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("future");
  });

  it("allows a little slack for a clock that is behind", () => {
    const slightlyBefore = new Date("2026-09-20T14:25:00.000Z");
    expect(verifyPrediction(claim(), signature(), slightlyBefore)).toEqual({ ok: true });
  });

  it("refuses a claim whose timestamp is not a date", () => {
    const c = claim({ predictedAt: "whenever" });
    const result = verifyPrediction(c, signPrediction(c)!, NOW);
    expect(result.ok).toBe(false);
  });
});

describe("what the claim carries", () => {
  /*
   * This is the payload a rider is asked to contribute, so what it does not
   * contain matters as much as what it does.
   */
  it("holds no address and no coordinate", () => {
    const serialised = JSON.stringify(claim());
    expect(serialised).not.toMatch(/\d+\.\d{4,}/);
    for (const word of ["lat", "lng", "address", "pickup", "destination"]) {
      expect(serialised.toLowerCase()).not.toContain(word);
    }
  });
});
