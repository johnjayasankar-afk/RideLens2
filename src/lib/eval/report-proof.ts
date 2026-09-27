/**
 * A prediction the rider can carry away and bring back.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The corpus is empty, and two things kept it that way. The question       │
 * │ "what did you actually pay?" was asked on the handoff page — the         │
 * │ interstitial *before* the rider leaves for the provider, which is the    │
 * │ one moment they cannot possibly know. And a rider who answered later,    │
 * │ when they did know, was told "that comparison has expired", because      │
 * │ `/api/actuals` looked the prediction up in a live session.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The rider's own device already holds the prediction. The problem with
 * simply accepting it back is that anyone could then post whatever pair of
 * numbers made the model look good, and a calibration corpus that accepts
 * unverified predictions measures nothing.
 *
 * So the prediction is signed when it is made. The rider keeps the claim and
 * the signature; days later they send both back with the fare they paid, and
 * the server checks that it really did say that. No session has to survive,
 * and nothing the client can edit enters the corpus.
 *
 * ── What is in the claim, and what is not ──────────────────────────────────
 *
 * Exactly the fields `ActualRecord` needs: a one-way route hash, the
 * provider and product, the market, the predicted band, when it was
 * predicted, the model version, the distance, and the predicted wait. No
 * addresses and no coordinates — the route hash is a digest, not a location.
 * This is the payload a rider is asked to contribute, so it is worth being
 * able to read the whole of it in one place.
 *
 * ── Without a secret ───────────────────────────────────────────────────────
 *
 * `RIDELENS_REPORT_SECRET` is optional. Unset, `sign` returns null, no proof
 * is issued, and reporting falls back to the live-session path it used
 * before. A deployment that has not configured one is no worse off than it
 * was; it simply cannot accept late reports.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/config";

/** How long a signed prediction stays reportable. */
export const PROOF_MAX_AGE_DAYS = 7;

export interface PredictionClaim {
  /** One-way digest of the rounded route — see `routeHash`. */
  routeHash: string;
  provider: string;
  productId: string;
  marketId: string | null;
  predictedMinMinor: number;
  predictedMaxMinor: number;
  /** ISO 8601, and the clock the age limit is measured against. */
  predictedAt: string;
  modelVersion: string;
  distanceMeters: number | null;
  predictedWaitLowSeconds: number | null;
  predictedWaitHighSeconds: number | null;
}

/**
 * Serialise unambiguously.
 *
 * Length-prefixed rather than delimited, so no field can contain something
 * that looks like a boundary and shift the meaning of the ones after it. A
 * product name with a colon in it would otherwise be able to forge a
 * different claim with the same signature.
 */
function canonical(claim: PredictionClaim): string {
  const parts = [
    claim.routeHash,
    claim.provider,
    claim.productId,
    claim.marketId ?? "",
    String(claim.predictedMinMinor),
    String(claim.predictedMaxMinor),
    claim.predictedAt,
    claim.modelVersion,
    claim.distanceMeters == null ? "" : String(Math.round(claim.distanceMeters)),
    claim.predictedWaitLowSeconds == null ? "" : String(claim.predictedWaitLowSeconds),
    claim.predictedWaitHighSeconds == null ? "" : String(claim.predictedWaitHighSeconds),
  ];
  return `v1|${parts.map((p) => `${p.length}:${p}`).join("")}`;
}

function secret(): string | null {
  const value = getEnv().RIDELENS_REPORT_SECRET;
  return value && value.length >= 16 ? value : null;
}

/** Whether late reporting is available at all in this deployment. */
export function proofsAvailable(): boolean {
  return secret() !== null;
}

/** Sign a prediction, or return null when no secret is configured. */
export function signPrediction(claim: PredictionClaim): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key).update(canonical(claim)).digest("base64url");
}

export type ProofFailure = "no_secret" | "bad_signature" | "expired" | "future";

/**
 * Check a returned claim.
 *
 * Compared in constant time: a signature check that returns early on the
 * first wrong byte tells an attacker how much of a guess was right.
 */
export function verifyPrediction(
  claim: PredictionClaim,
  signature: string,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: ProofFailure } {
  const expected = signPrediction(claim);
  if (!expected) return { ok: false, reason: "no_secret" };

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  /*
   * The signature proves the prediction was ours. It does not stop the same
   * one being replayed in a year, by which time the model has moved and the
   * fare it is scored against belongs to a different market.
   */
  const predictedAt = new Date(claim.predictedAt).getTime();
  if (!Number.isFinite(predictedAt)) return { ok: false, reason: "expired" };

  const ageMs = now.getTime() - predictedAt;
  if (ageMs > PROOF_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return { ok: false, reason: "expired" };
  /* A little slack for a clock that is behind ours, but not a lot. */
  if (ageMs < -10 * 60 * 1000) return { ok: false, reason: "future" };

  return { ok: true };
}
