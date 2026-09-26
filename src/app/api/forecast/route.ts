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
import type { NormalizedQuote } from "@/lib/domain/types";
import type {
  MarketplaceProduct,
  MarketplaceProvider,
} from "@/lib/sources/ratecard/marketplace-dynamics";
import type { WaitCategory } from "@/lib/sources/ratecard/wait-eta";

export const dynamic = "force-dynamic";

const MARKETPLACE_PROVIDERS = new Set<MarketplaceProvider>(["uber", "lyft", "empower", "curb"]);
const FARE_PRODUCTS = new Set<MarketplaceProduct>([
  "uberx",
  "comfort",
  "uberxl",
  "lyft",
  "lyft_xl",
  "taxi",
  "empower",
]);

/** Only quotes this model produced can be run forward by this model. */
function projectable(quote: NormalizedQuote): ForecastInput | null {
  if (quote.source !== "public_rate_card") return null;
  const provider = quote.provider as MarketplaceProvider;
  if (!MARKETPLACE_PROVIDERS.has(provider)) return null;

  const product = quote.metadata?.fareProduct as MarketplaceProduct | undefined;
  if (!product || !FARE_PRODUCTS.has(product)) return null;

  const meters = quote.distanceMeters;
  const seconds = quote.tripDurationSeconds;
  if (!meters || !seconds) return null;

  return {
    provider,
    product,
    waitCategory: quote.normalizedCategory as WaitCategory,
    pickup: { lat: 0, lng: 0 }, // replaced by the caller, which has the session
    destination: { lat: 0, lng: 0 },
    miles: meters / 1609.344,
    osrmMinutes: seconds / 60,
    weatherSurgeLift: quote.metadata?.weatherSurgeLift as number | undefined,
  };
}

export async function GET(req: NextRequest) {
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
   * One forecast per product, not per quote. Two quotes for the same product
   * would produce identical curves and double the work.
   */
  const seen = new Set<string>();
  const inputs: ForecastInput[] = [];
  let skipped = 0;

  for (const quote of session.quotes) {
    const base = projectable(quote);
    if (!base) {
      skipped += 1;
      continue;
    }
    const key = `${base.provider}:${base.product}`;
    if (seen.has(key)) continue;
    seen.add(key);
    inputs.push({ ...base, pickup, destination });
  }

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
