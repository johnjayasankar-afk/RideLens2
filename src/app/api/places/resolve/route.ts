import { NextRequest, NextResponse } from "next/server";
import { getGeocoder } from "@/lib/location/geocoder";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(rateLimitKey({ ip, action: "places_resolve" }), 60, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const placeId = req.nextUrl.searchParams.get("placeId") || "";
  const q = req.nextUrl.searchParams.get("q") || "";
  const geo = getGeocoder();
  const location =
    (placeId ? await geo.resolve(placeId) : null) ||
    (q ? await geo.resolve(q) : null);

  if (!location) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ location });
}
