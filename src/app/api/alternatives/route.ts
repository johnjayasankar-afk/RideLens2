/**
 * What else you could do instead of taking a car.
 *
 * Separate from /api/quotes for the same reason the forecast is: it is worth
 * knowing and nobody is blocked on it, and the walking lookup goes to a
 * third-party router that should never be able to delay a comparison.
 */
import { NextRequest, NextResponse } from "next/server";

import {
  transitAlternativeFor,
  walkAlternative,
  withJourneyTime,
} from "@/lib/transit/alternatives";
import { measuredJourneyFor } from "@/lib/transit/journey-time";
import { transitRoutingConfigured } from "@/lib/config";
import type { TransitAlternative } from "@/lib/transit/types";
import { fetchWalkingSeconds } from "@/lib/routing/osrm";
import { getSession } from "@/lib/quotes/orchestrator";
import { rateLimit, rateLimitKey } from "@/lib/quotes/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  /*
   *  Reaches outward for transit and walking legs, so it is capped
   *  like any other route that spends someone else's capacity.
   */
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(rateLimitKey({ ip, action: "alternatives" }), 40, 60);
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

  const alternatives: TransitAlternative[] = [];

  const transit = transitAlternativeFor(pickup, destination);

  /*
   * Only ask about walking for a trip that could plausibly be walked. The
   * router is somebody else's server and a Midtown-to-JFK walk query is a
   * request nobody needed the answer to.
   */
  const straightLineKm = haversineKm(pickup, destination);

  /*
   * Both outward lookups at once, and neither can fail this route: each
   * resolves to null rather than throwing, so there is no rejection for
   * `Promise.all` to propagate. Done in sequence this would be two round
   * trips on a path nobody is blocked on.
   *
   * The journey time is asked for only where a transit row exists. Most trips
   * produce none, and a routing tier is measured in requests.
   */
  const [journey, walkSeconds] = await Promise.all([
    transit ? measuredJourneyFor(pickup, destination) : Promise.resolve(null),
    straightLineKm <= 2.5 ? fetchWalkingSeconds(pickup, destination) : Promise.resolve(null),
  ]);

  if (transit) alternatives.push(withJourneyTime(transit, journey));

  const walk = walkAlternative(walkSeconds);
  if (walk) alternatives.push(walk);

  /*
   * The cheapest car on the board, so the row can say what the alternative
   * is cheaper *than* — using the low end, which is the most favourable
   * number the car has. If transit still wins against that, it wins.
   */
  const carLowMinor = session.quotes.reduce<number | null>((min, q) => {
    if (q.availability === "UNAVAILABLE") return min;
    return min == null || q.priceMinMinor < min ? q.priceMinMinor : min;
  }, null);

  /*
   * `journeyTimes` says which mode this route is in, the way /api/ask's GET
   * reports model versus local. "measured" does not promise every row has a
   * time — a source can be configured and still decline — it says a source
   * was asked. Without it, "no time" and "no source" look identical from
   * outside, and an operator cannot tell a spent quota from a missing var.
   */
  return NextResponse.json({
    alternatives,
    carLowMinor,
    journeyTimes: transitRoutingConfigured() ? "measured" : "not-configured",
  });
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
