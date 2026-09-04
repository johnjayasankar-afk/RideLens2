import { NextRequest, NextResponse } from "next/server";
import { fetchDrivingRoute } from "@/lib/routing/osrm";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  fromLat: z.coerce.number().min(-90).max(90),
  fromLng: z.coerce.number().min(-180).max(180),
  toLat: z.coerce.number().min(-90).max(90),
  toLng: z.coerce.number().min(-180).max(180),
});

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(rateLimitKey({ ip, action: "route" }), 60, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const parsed = schema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const { fromLat, fromLng, toLat, toLng } = parsed.data;
  const route = await fetchDrivingRoute(
    { lat: fromLat, lng: fromLng },
    { lat: toLat, lng: toLng },
  );

  return NextResponse.json({
    route: {
      meters: route.meters,
      seconds: route.seconds,
      miles: Math.round(route.miles * 10) / 10,
      minutes: Math.round(route.minutes),
      via: route.via,
      geometry: route.geometry,
      bbox: route.bbox,
    },
  });
}
