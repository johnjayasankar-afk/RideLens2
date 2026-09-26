/**
 * Would walking a couple of blocks be cheaper?
 *
 * Prices the same trip from a handful of points around the rider and asks a
 * routing engine how long it takes to reach each one. Only the cheapest
 * plausible candidates are routed — the walk router is somebody else's
 * server and sixteen speculative queries per comparison is not a reasonable
 * thing to send it.
 */
import { NextRequest, NextResponse } from "next/server";

import { chooseWalk, coolerCandidates, type PricedCandidate } from "@/lib/domain/walk-off-hotspot";
import { computeProductFare } from "@/lib/sources/ratecard/fare-engine";
import type { FareProduct } from "@/lib/sources/ratecard/fare-engine";
import { fetchWalkingSeconds } from "@/lib/routing/osrm";
import { getSession } from "@/lib/quotes/orchestrator";

export const dynamic = "force-dynamic";

/** Routed candidates per request. Each one is an outbound HTTP call. */
const MAX_ROUTED = 3;

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
  const now = new Date();

  /*
   * Anchored to the cheapest modeled quote on the board — the option the
   * rider would actually take. A saving measured against something they were
   * never going to book is not a saving.
   */
  const anchor = session.quotes
    .filter((q) => q.source === "public_rate_card" && q.availability !== "UNAVAILABLE")
    .sort((a, b) => a.priceMinMinor - b.priceMinMinor)[0];

  if (!anchor) return NextResponse.json({ suggestion: null, reason: "nothing-modeled" });

  const product = anchor.metadata?.fareProduct as FareProduct | undefined;
  const meters = anchor.distanceMeters;
  const seconds = anchor.tripDurationSeconds;
  if (!product || !meters || !seconds) {
    return NextResponse.json({ suggestion: null, reason: "not-projectable" });
  }

  const candidates = coolerCandidates(pickup, now);
  if (candidates.length === 0) {
    return NextResponse.json({ suggestion: null, reason: "not-in-a-hotspot" });
  }

  /*
   * Price every candidate — cheap, all local arithmetic — then route only
   * the few that actually look cheaper.
   */
  const pricedAll = candidates.map((c) => {
    const fare = computeProductFare({
      product,
      provider: anchor.provider as "uber" | "lyft" | "empower" | "curb",
      pickup: { lat: c.lat, lng: c.lng },
      destination,
      miles: meters / 1609.344,
      osrmMinutes: seconds / 60,
      now,
      weatherSurgeLift: anchor.metadata?.weatherSurgeLift as number | undefined,
    });
    return {
      ...c,
      lowMinor: Math.round(fare.low * 100),
      highMinor: Math.round(fare.high * 100),
      walkSeconds: null as number | null,
    };
  });

  const anchorCentre = (anchor.priceMinMinor + anchor.priceMaxMinor) / 2;
  const worthRouting = pricedAll
    .filter((c) => (c.lowMinor + c.highMinor) / 2 < anchorCentre)
    .sort((a, b) => a.highMinor - b.highMinor)
    .slice(0, MAX_ROUTED);

  if (worthRouting.length === 0) {
    return NextResponse.json({ suggestion: null, reason: "no-cheaper-corner" });
  }

  const routed: PricedCandidate[] = await Promise.all(
    worthRouting.map(async (c) => ({
      ...c,
      walkSeconds: await fetchWalkingSeconds(pickup, { lat: c.lat, lng: c.lng }),
    })),
  );

  const suggestion = chooseWalk(anchor.priceMinMinor, anchor.priceMaxMinor, routed);
  return NextResponse.json({
    suggestion,
    anchor: {
      provider: anchor.provider,
      productName: anchor.providerProductName,
      lowMinor: anchor.priceMinMinor,
      highMinor: anchor.priceMaxMinor,
    },
  });
}
