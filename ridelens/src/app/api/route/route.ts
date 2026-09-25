/**
 * POST /api/route — road geometry for the map.
 *
 * Separate from the quote stream on purpose: the map is decoration relative to
 * the prices, and a slow map service must never delay a fare. The client
 * requests it after results are already on screen.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchRouteGeometry } from '@/location/routing';
import { apiError, withErrorEnvelope } from '../_lib/errors';
import { enforceRateLimit } from '../_lib/request';

export const dynamic = 'force-dynamic';

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const Schema = z.object({ pickup: Point, destination: Point });

export const POST = withErrorEnvelope('POST /api/route', async (req) => {
  const limit = await enforceRateLimit(req, 'route');
  if (!limit.ok) return limit.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, 'BAD_REQUEST', 'Body must be JSON.');
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError(400, 'BAD_REQUEST', 'Invalid coordinates.');

  const stub = (p: z.infer<typeof Point>) => ({
    ...p,
    formattedAddress: '',
    placeId: null,
    name: '',
    city: null,
    region: null,
    country: null,
    geocoder: 'client',
  });

  const geometry = await fetchRouteGeometry(
    stub(parsed.data.pickup),
    stub(parsed.data.destination),
    req.signal,
  );

  return NextResponse.json(
    { geometry },
    { headers: { ...limit.headers, 'Cache-Control': 'no-store' } },
  );
});
