import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedBookingUrl } from "@/lib/booking/booking-link-resolver";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";

const bodySchema = z.object({
  url: z.string().url(),
  provider: z.string(),
  sessionId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(rateLimitKey({ ip, action: "book" }), 60, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!isAllowedBookingUrl(parsed.data.url)) {
    return NextResponse.json(
      { error: "Booking URL not allowlisted" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    redirectTo: parsed.data.url,
  });
}
