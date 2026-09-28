/**
 * The next hour, for a comparison that already happened.
 *
 * Separate from /api/quotes rather than folded into it. The strip sits below
 * the fold, most riders never look at it, and projecting three providers
 * across thirteen points is ~200 runs of the fare engine — cheap, but not
 * something to put on the path of every comparison.
 *
 * Only the modeled source can be projected, and that is not a limitation to
 * work around: a partner's quote is a price they are holding for the next few
 * minutes, and there is no honest way to extrapolate it to 6pm. Quotes from a
 * partner are skipped here and the response says how many.
 */
import { NextRequest, NextResponse } from "next/server";

import { buildDepartureWindow, type ForecastInput } from "@/lib/domain/departure-window";
import { getSession } from "@/lib/quotes/orchestrator";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";
import { replayableProducts } from "@/lib/quotes/replayable";
import type { MarketplaceProduct } from "@/lib/sources/ratecard/marketplace-dynamics";
import type { WaitCategory } from "@/lib/sources/ratecard/wait-eta";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  /*
   *  Pure computation over a session already in hand, so the ceiling
   *  is about protecting this process rather than anyone else's.
   */
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(rateLimitKey({ ip, action: "forecast" }), 60, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests just now.", retryAfter: rl.retryAfterSeconds },
      { status: 429 },
    );
  }

  const id = req.nextUrl.searchParams.get("session");
  if (!id) {
    return NextResponse.json({ error: "session is required." }, { status: 400 });
  }

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
   * One forecast per product, not per quote — `replayableProducts` does the
   * de-duplication, and the same filter decides what /api/sensitivity may
   * re-run. Two definitions of "this model may recompute that" would
   * eventually disagree about a partner quote, and one of them would be the
   * one that extrapolated it.
   */
  const { items, skipped } = replayableProducts(session.quotes);
  const inputs: ForecastInput[] = items.map((item) => ({
    provider: item.provider,
    product: item.product as MarketplaceProduct,
    waitCategory: item.category as WaitCategory,
    pickup,
    destination,
    miles: item.miles,
    osrmMinutes: item.osrmMinutes,
    weatherSurgeLift: item.weatherSurgeLift,
  }));

  if (inputs.length === 0) {
    return NextResponse.json({
      window: null,
      skipped,
      reason:
        "Nothing here is a modeled estimate, so there is nothing to project. A partner's quote is a price they are holding now, not a curve.",
    });
  }

  return NextResponse.json({ window: buildDepartureWindow(inputs), skipped });
}
