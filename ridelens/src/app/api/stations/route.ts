/**
 * POST /api/stations — live bike-share stations near a route.
 *
 * Feeds the map, not the price. Requested after results are on screen so a
 * slow feed can never delay a fare, and bounded to a corridor around the route
 * so a dense city does not ship two thousand markers to a phone.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { distanceMeters } from '@/domain/geo';
import { fetchSystemSnapshot } from '@/sources/bikeshare/gbfs';
import { systemsFor } from '@/sources/bikeshare/systems';
import { getConfig } from '@/config/env';
import { apiError, withErrorEnvelope } from '../_lib/errors';
import { enforceRateLimit } from '../_lib/request';

export const dynamic = 'force-dynamic';

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const Schema = z.object({ pickup: Point, destination: Point });

/** Stations further than this from either endpoint are not worth drawing. */
const CORRIDOR_METERS = 900;
const MAX_STATIONS = 60;

export const POST = withErrorEnvelope('POST /api/stations', async (req) => {
  const limit = await enforceRateLimit(req, 'route');
  if (!limit.ok) return limit.response;

  if (getConfig().ENABLE_BIKE_SHARE !== 'true') {
    return NextResponse.json({ stations: [] }, { headers: limit.headers });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, 'BAD_REQUEST', 'Body must be JSON.');
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError(400, 'BAD_REQUEST', 'Invalid coordinates.');

  const { pickup, destination } = parsed.data;
  const system = systemsFor(pickup).find((s) => systemsFor(destination).some((d) => d.id === s.id));
  if (!system) return NextResponse.json({ stations: [] }, { headers: limit.headers });

  const snapshot = await fetchSystemSnapshot(system, req.signal);
  if (!snapshot) return NextResponse.json({ stations: [] }, { headers: limit.headers });

  const near = snapshot.stations
    .map((s) => ({
      station: s,
      d: Math.min(distanceMeters(pickup, s), distanceMeters(destination, s)),
    }))
    .filter((x) => x.d <= CORRIDOR_METERS)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_STATIONS)
    .map(({ station }) => ({
      id: station.id,
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      bikes: station.bikesAvailable + station.ebikesAvailable,
      docks: station.docksAvailable,
    }));

  return NextResponse.json(
    { system: system.name, stations: near, lastUpdated: snapshot.lastUpdated },
    { headers: { ...limit.headers, 'Cache-Control': 'no-store' } },
  );
});
