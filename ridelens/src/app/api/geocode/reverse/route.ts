import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getGeocoder } from '@/location/geocoder';
import { apiError, withErrorEnvelope } from '../../_lib/errors';
import { enforceRateLimit } from '../../_lib/request';

export const dynamic = 'force-dynamic';

const Schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const GET = withErrorEnvelope('GET /api/geocode/reverse', async (req) => {
  const limit = await enforceRateLimit(req, 'geocode');
  if (!limit.ok) return limit.response;

  const url = new URL(req.url);
  const parsed = Schema.safeParse({
    lat: url.searchParams.get('lat'),
    lng: url.searchParams.get('lng'),
  });
  if (!parsed.success) return apiError(400, 'BAD_REQUEST', 'Invalid coordinates.');

  try {
    const location = await getGeocoder().reverse(parsed.data.lat, parsed.data.lng);
    return NextResponse.json(
      { location },
      { headers: { ...limit.headers, 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ location: null, degraded: true }, { headers: limit.headers });
  }
});
