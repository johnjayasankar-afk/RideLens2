import { NextRequest, NextResponse } from "next/server";
import { getGeocoder } from "@/lib/location/geocoder";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";
import { placesQuerySchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(rateLimitKey({ ip, action: "places" }), 60, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = placesQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const geo = getGeocoder();
  const proximity =
    parsed.data.lat != null && parsed.data.lng != null
      ? { lat: parsed.data.lat, lng: parsed.data.lng }
      : undefined;
  const suggestions = await geo.autocomplete(parsed.data.q, proximity);
  const seen = new Set<string>();
  const deduped = [];
  for (const s of suggestions) {
    const key = `${(s.formattedAddress || s.primaryText || "").toLowerCase()}|${s.lat ?? ""}|${s.lng ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  return NextResponse.json({ suggestions: deduped });
}
