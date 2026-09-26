/**
 * What else you could do instead of taking a car.
 *
 * Separate from /api/quotes for the same reason the forecast is: it is worth
 * knowing and nobody is blocked on it, and the walking lookup goes to a
 * third-party router that should never be able to delay a comparison.
 */
import { NextRequest, NextResponse } from "next/server";

import { transitAlternativeFor, walkAlternative } from "@/lib/transit/alternatives";
import type { TransitAlternative } from "@/lib/transit/types";
import { fetchWalkingSeconds } from "@/lib/routing/osrm";
import { getSession } from "@/lib/quotes/orchestrator";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
  if (transit) alternatives.push(transit);

  /*
   * Only ask about walking for a trip that could plausibly be walked. The
   * router is somebody else's server and a Midtown-to-JFK walk query is a
   * request nobody needed the answer to.
   */
  const straightLineKm = haversineKm(pickup, destination);
  if (straightLineKm <= 2.5) {
    const walk = walkAlternative(await fetchWalkingSeconds(pickup, destination));
    if (walk) alternatives.push(walk);
  }

  /*
   * The cheapest car on the board, so the row can say what the alternative
   * is cheaper *than* — using the low end, which is the most favourable
   * number the car has. If transit still wins against that, it wins.
   */
  const carLowMinor = session.quotes.reduce<number | null>((min, q) => {
    if (q.availability === "UNAVAILABLE") return min;
    return min == null || q.priceMinMinor < min ? q.priceMinMinor : min;
  }, null);

  return NextResponse.json({ alternatives, carLowMinor });
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
