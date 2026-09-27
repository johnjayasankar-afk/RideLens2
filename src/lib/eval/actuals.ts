/**
 * "What did you actually pay?"
 *
 * The one question that turns a model into a measurable one. Everything in
 * src/lib/eval scores predictions against these rows, and without them
 * docs/CALIBRATION.md can only say it does not know.
 *
 * Deliberately small and deliberately optional. A rider who ignores it loses
 * nothing, and one who answers it gives the product the only ground truth it
 * can get without a partner feed.
 */
import { supabaseConfigured } from "@/lib/config";
import type { NormalizedQuote, QuoteSession } from "@/lib/domain/types";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import type { ActualRecord } from "./metrics";
import { createHash } from "node:crypto";

import type { CorpusRecord } from "./corpus";
import type { PredictionClaim } from "./report-proof";

/**
 * A stable id for a route, so the same corridor groups across sessions.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This used to return "40.722:-73.994:40.645:-73.780" under a comment      │
 * │ that said "the hash is not a location". It was a location — the rounded  │
 * │ coordinates, joined by colons, to within about 110 m of both ends of     │
 * │ somebody's journey. The test that guarded the claim only checked that    │
 * │ the *unrounded* figure was absent, which it always was.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Rounding first is still right: finer than about 100 m and a corridor never
 * accumulates enough samples to report, coarser and two genuinely different
 * trips merge. But rounding is not concealment, and this value leaves the
 * device. So the rounded grid cell is hashed, one way, and only the digest
 * is kept.
 *
 * A determined attacker with the whole city's grid could still enumerate
 * cells and match digests — a hash of a small domain is not a secret. What
 * it does buy is that the corpus, a database dump, or a log line no longer
 * reads as a pair of street corners, and that is the realistic exposure.
 */
export function routeHash(session: Pick<QuoteSession, "pickup" | "destination">): string {
  const r = (n: number) => n.toFixed(3);
  const cell = [
    r(session.pickup.lat),
    r(session.pickup.lng),
    r(session.destination.lat),
    r(session.destination.lng),
  ].join(":");
  /* Truncated: 128 bits is far past collision risk for a city's worth of
     corridors, and a shorter key keeps the corpus readable. */
  return createHash("sha256").update(`ridelens:route:${cell}`).digest("hex").slice(0, 32);
}

export interface ReportInput {
  session: QuoteSession;
  quote: NormalizedQuote;
  /** What they paid, in minor units. */
  actualMinor: number;
  note?: string;
}

export type ReportOutcome = { ok: true; stored: boolean } | { ok: false; reason: string };

/** Nobody pays $12,000 for a cab. A typo should not become a data point. */
const MAX_PLAUSIBLE_MINOR = 100_000;

/**
 * The same checks whichever way the prediction arrived.
 *
 * Split out because a report can now come back days later carrying a signed
 * prediction rather than a live session — see report-proof.ts — and the
 * amount has to be judged identically either way.
 */
export function validateAmount(actualMinor: number, predictedMinMinor: number): string | null {
  if (!Number.isFinite(actualMinor)) return "That is not a number.";
  if (actualMinor <= 0) return "A fare has to be more than zero.";
  if (actualMinor > MAX_PLAUSIBLE_MINOR) {
    return "That is higher than any fare this product models. Check the amount.";
  }
  if (predictedMinMinor <= 0) return "This quote has no price to compare against.";
  return null;
}

export function validateReport(input: ReportInput): string | null {
  return validateAmount(input.actualMinor, input.quote.priceMinMinor);
}

/**
 * Record what a rider paid.
 *
 * Stores the prediction alongside the actual rather than referring to the
 * session for it: a session expires, and a calibration record that loses its
 * own prediction is worthless. This is duplication on purpose.
 */
export async function recordActual(input: ReportInput): Promise<ReportOutcome> {
  const invalid = validateReport(input);
  if (invalid) return { ok: false, reason: invalid };

  return persist({
    session_id: input.session.id,
    route_hash: routeHash(input.session),
    provider: input.quote.provider,
    product_id: input.quote.providerProductId,
    market_id: (input.quote.metadata?.marketId as string) ?? null,
    predicted_min_minor: input.quote.priceMinMinor,
    predicted_max_minor: input.quote.priceMaxMinor,
    predicted_at: input.quote.receivedAt,
    model_version: (input.quote.metadata?.modelVersion as string) ?? null,
    actual_minor: Math.round(input.actualMinor),
    currency: input.quote.currency,
    note: input.note?.slice(0, 500) ?? null,
  });
}

/**
 * Record a fare against a prediction the server signed earlier.
 *
 * The caller must have verified the signature first — this function trusts
 * the claim it is handed, and the whole integrity of the corpus rests on
 * that check having happened. `/api/actuals` is the only caller.
 *
 * There is no session id: the session expired days ago, which is the reason
 * this path exists at all.
 */
export async function recordVerifiedActual(input: {
  claim: PredictionClaim;
  actualMinor: number;
  note?: string;
}): Promise<ReportOutcome> {
  const invalid = validateAmount(input.actualMinor, input.claim.predictedMinMinor);
  if (invalid) return { ok: false, reason: invalid };

  return persist({
    session_id: null,
    route_hash: input.claim.routeHash,
    provider: input.claim.provider,
    product_id: input.claim.productId,
    market_id: input.claim.marketId,
    predicted_min_minor: input.claim.predictedMinMinor,
    predicted_max_minor: input.claim.predictedMaxMinor,
    predicted_at: input.claim.predictedAt,
    model_version: input.claim.modelVersion || null,
    actual_minor: Math.round(input.actualMinor),
    currency: "USD",
    note: input.note?.slice(0, 500) ?? null,
  });
}

/** One way in, whichever way the prediction was established. */
async function persist(row: Record<string, unknown>): Promise<ReportOutcome> {
  if (!supabaseConfigured()) {
    // Accepted and not stored. Telling a rider their report failed because of
    // our configuration would be noise they cannot act on; silently claiming
    // it was stored would be a lie. The caller knows which happened.
    logger.warn("actual_not_persisted", { reason: "supabase_not_configured" });
    return { ok: true, stored: false };
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("reported_actuals").insert(row);
    if (error) throw new Error(error.message);
    return { ok: true, stored: true };
  } catch (err) {
    logger.warn("actual_persist_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, reason: "Could not save that just now." };
  }
}

/** Reported actuals as corpus records, for `npm run eval`. */
export async function loadReportedActuals(limit = 5000): Promise<CorpusRecord[]> {
  if (!supabaseConfigured()) return [];
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("reported_actuals")
      .select("*")
      .order("reported_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Record<string, unknown>): CorpusRecord => ({
      origin: "reported",
      collectedVia: "rider report on the booking handoff",
      collectedOn: String(r.reported_at ?? "").slice(0, 10),
      routeHash: String(r.route_hash),
      provider: String(r.provider),
      productId: (r.product_id as string) ?? undefined,
      marketId: (r.market_id as string) ?? undefined,
      predictedMinMinor: Number(r.predicted_min_minor),
      predictedMaxMinor: Number(r.predicted_max_minor),
      predictedAt: String(r.predicted_at),
      modelVersion: (r.model_version as string) ?? undefined,
      actualMinor: Number(r.actual_minor),
    }));
  } catch (err) {
    logger.warn("actuals_load_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
}

export type { ActualRecord };
