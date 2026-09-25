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
import type { CorpusRecord } from "./corpus";

/**
 * A stable id for a route, so the same corridor groups across sessions.
 *
 * Rounded to about 100 m. Finer than that and a corridor never accumulates
 * enough samples to report; coarser and two genuinely different trips merge.
 * Coordinates are rounded rather than stored, so the hash is not a location.
 */
export function routeHash(session: Pick<QuoteSession, "pickup" | "destination">): string {
  const r = (n: number) => n.toFixed(3);
  return [
    r(session.pickup.lat),
    r(session.pickup.lng),
    r(session.destination.lat),
    r(session.destination.lng),
  ].join(":");
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

export function validateReport(input: ReportInput): string | null {
  if (!Number.isFinite(input.actualMinor)) return "That is not a number.";
  if (input.actualMinor <= 0) return "A fare has to be more than zero.";
  if (input.actualMinor > MAX_PLAUSIBLE_MINOR) {
    return "That is higher than any fare this product models. Check the amount.";
  }
  if (input.quote.priceMinMinor <= 0) return "This quote has no price to compare against.";
  return null;
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

  const row = {
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
  };

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
