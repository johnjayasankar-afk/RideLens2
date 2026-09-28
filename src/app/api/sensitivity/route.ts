/**
 * How much the estimate depends on the model being right about its inputs.
 *
 * Separate from /api/quotes for the same reason the forecast is: it is eight
 * scenarios across every priced product, which is cheap arithmetic but not
 * something to put on the path of a comparison somebody is waiting for.
 *
 * See src/lib/domain/sensitivity.ts for what the scenarios are and why they
 * are the model's own partial derivatives rather than a confidence score.
 */
import { NextRequest, NextResponse } from "next/server";

import { buildSensitivity, type SensitivitySubject } from "@/lib/domain/sensitivity";
import { getSession } from "@/lib/quotes/orchestrator";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";
import { replayableProducts } from "@/lib/quotes/replayable";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(rateLimitKey({ ip, action: "sensitivity" }), 60, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests just now.", retryAfter: rl.retryAfterSeconds },
      { status: 429 },
    );
  }

  const id = req.nextUrl.searchParams.get("session");
  if (!id) return NextResponse.json({ error: "session is required." }, { status: 400 });

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Session not found", reason: "unknown-or-expired" },
      { status: 404 },
    );
  }

  const pickup = { lat: session.pickup.lat, lng: session.pickup.lng };
  const destination = { lat: session.destination.lat, lng: session.destination.lng };

  /*
   * The board as the rider has it, not as the session was priced.
   *
   * A comparison filtered to Standard shows three options; the session holds
   * six. "The cheapest stays cheapest" answered about six is an answer about a
   * board nobody is looking at, and could name a winner the rider has filtered
   * away. The client sends the ids it is showing — a selector, not data:
   * everything priced still comes from the session.
   */
  const only = req.nextUrl.searchParams.get("only");
  const wanted = only ? new Set(only.split(",").filter(Boolean)) : null;
  const visible = wanted ? session.quotes.filter((q) => wanted.has(q.id)) : session.quotes;
  const { items, skipped } = replayableProducts(visible.length > 0 ? visible : session.quotes);

  if (items.length === 0) {
    return NextResponse.json({
      report: null,
      skipped,
      reason:
        "Nothing here is a modeled estimate, so there is nothing to re-run. A partner's price " +
        "is theirs, and asking what it would be under different traffic would be inventing an " +
        "answer on their behalf.",
    });
  }

  const subjects: SensitivitySubject[] = items.map((item) => ({
    id: item.quoteId,
    label: item.label,
    provider: item.provider,
    product: item.product,
    pickup,
    destination,
    miles: item.miles,
    osrmMinutes: item.osrmMinutes,
    weatherSurgeLift: item.weatherSurgeLift,
    bandLowDollars: item.bandLowDollars,
    bandHighDollars: item.bandHighDollars,
  }));

  /*
   * Priced at the moment the session was, not now.
   *
   * The engine is deterministic given a clock, so this reproduces the figures
   * on the card and every scenario is a departure from those. Using request
   * time instead would put the baseline on a different marketplace tick than
   * the band it is drawn against — see buildSensitivity.
   */
  const pricedAt = new Date(session.createdAt);
  return NextResponse.json({
    report: buildSensitivity(subjects, Number.isNaN(pricedAt.getTime()) ? new Date() : pricedAt),
    skipped,
  });
}
