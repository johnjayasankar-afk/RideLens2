import { NextRequest, NextResponse } from "next/server";
import { isAllowedBookingUrl } from "@/lib/booking/booking-link-resolver";
import { getEnv } from "@/lib/config";
import { listAllSources } from "@/lib/sources/registry";
import { getUsageToday, listRecentSessions } from "@/lib/quotes/orchestrator";
import { cacheStats } from "@/lib/quotes/cache";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const env = getEnv();
  const secret = env.RIDELENS_ADMIN_SECRET;
  if (!secret) return env.NODE_ENV !== "production";
  const header = req.headers.get("x-admin-secret");
  return header === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const health = await Promise.all(
    listAllSources().map(async (s) => ({
      capabilities: s.capabilities(),
      health: await s.healthCheck(),
    })),
  );

  return NextResponse.json({
    usageToday: getUsageToday(),
    cache: cacheStats(),
    sources: health,
    recentSessions: listRecentSessions(10).map((s) => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      providers: s.coverage.providersReturned,
      quoteCount: s.quotes.length,
      failures: s.coverage.sourcesFailed,
    })),
    bookingAllowlistCheck: {
      uber: isAllowedBookingUrl("https://m.uber.com/looking"),
      lyft: isAllowedBookingUrl("https://www.lyft.com/ride"),
      curb: isAllowedBookingUrl("https://gocurb.com/"),
      empower: isAllowedBookingUrl("https://www.rideempower.com/"),
    },
  });
}
