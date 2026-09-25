import { NextResponse, type NextRequest } from "next/server";

import { recordActual } from "@/lib/eval/actuals";
import { getSession } from "@/lib/quotes/orchestrator";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";

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

  let body: { sessionId?: string; quoteId?: string; actualMinor?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!body.sessionId || !body.quoteId || typeof body.actualMinor !== "number") {
    return NextResponse.json(
      { error: "sessionId, quoteId and actualMinor are required." },
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
