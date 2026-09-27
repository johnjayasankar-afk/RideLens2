import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

import { recordActual, recordVerifiedActual } from "@/lib/eval/actuals";
import { verifyPrediction } from "@/lib/eval/report-proof";
import { getSession } from "@/lib/quotes/orchestrator";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";

/*
 * Validated rather than trusted, even though the signature is checked
 * immediately after: verifyPrediction re-serialises these fields, and a
 * field of the wrong type would serialise to something that could not have
 * been signed anyway. This turns that into a clear 400 instead.
 */
const claimSchema = z.object({
  routeHash: z.string().min(1).max(64),
  provider: z.string().min(1).max(32),
  productId: z.string().min(1).max(64),
  marketId: z.string().max(64).nullable(),
  predictedMinMinor: z.number().int().nonnegative(),
  predictedMaxMinor: z.number().int().nonnegative(),
  predictedAt: z.string().min(1).max(40),
  modelVersion: z.string().max(64),
  distanceMeters: z.number().nullable(),
  predictedWaitLowSeconds: z.number().nullable(),
  predictedWaitHighSeconds: z.number().nullable(),
});

/** What to tell the rider. None of these are their fault. */
const REASONS: Record<string, string> = {
  no_secret: "This deployment cannot accept reports after the fact.",
  bad_signature: "That report could not be verified.",
  expired: "That comparison is too old to report against.",
  future: "That report is dated ahead of the comparison.",
};

export const dynamic = "force-dynamic";

/**
 * "What did you actually pay?"
 *
 * Rate-limited like any other write, and deliberately tolerant: a report that
 * cannot be stored is still accepted, because a rider who took the trouble to
 * answer should not be shown an error about our configuration.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const limit = rateLimit(rateLimitKey({ ip, action: "report-actual" }), 10, 300);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many reports just now.", retryAfter: limit.retryAfterSeconds },
      { status: 429 },
    );
  }

  let body: {
    sessionId?: string;
    quoteId?: string;
    actualMinor?: number;
    note?: string;
    claim?: unknown;
    signature?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (typeof body.actualMinor !== "number") {
    return NextResponse.json({ error: "actualMinor is required." }, { status: 400 });
  }

  /*
   * ── The late path ────────────────────────────────────────────────────────
   *
   * A rider only knows what a trip cost once it is over, which is long after
   * the comparison expired. Asking them to answer while the session is still
   * alive is asking them to answer before they can — it is why this corpus
   * was empty. So a signed prediction they carried away is accepted in place
   * of a session, and verified before anything is written.
   */
  if (body.claim !== undefined || body.signature !== undefined) {
    const parsed = claimSchema.safeParse(body.claim);
    if (!parsed.success || typeof body.signature !== "string") {
      return NextResponse.json({ error: "Malformed report." }, { status: 400 });
    }

    const verdict = verifyPrediction(parsed.data, body.signature);
    if (!verdict.ok) {
      const status = verdict.reason === "expired" || verdict.reason === "future" ? 410 : 400;
      return NextResponse.json({ error: REASONS[verdict.reason] }, { status });
    }

    const result = await recordVerifiedActual({
      claim: parsed.data,
      actualMinor: body.actualMinor,
      note: typeof body.note === "string" ? body.note : undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
    return NextResponse.json({ ok: true, stored: result.stored });
  }

  if (!body.sessionId || !body.quoteId) {
    return NextResponse.json(
      { error: "sessionId and quoteId are required when no signed prediction is sent." },
      { status: 400 },
    );
  }

  const session = await getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "That comparison has expired." }, { status: 404 });
  }
  const quote = session.quotes.find((q) => q.id === body.quoteId);
  if (!quote) {
    return NextResponse.json({ error: "That option is not in this comparison." }, { status: 404 });
  }

  const result = await recordActual({
    session,
    quote,
    actualMinor: body.actualMinor,
    note: body.note,
  });

  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ok: true, stored: result.stored });
}
