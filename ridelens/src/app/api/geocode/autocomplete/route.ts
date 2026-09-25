import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getGeocoder } from '@/location/geocoder';
import { rankSuggestions } from '@/location/rank';
import { logger } from '@/observability/logger';
import { apiError, withErrorEnvelope } from '../../_lib/errors';
import { enforceRateLimit } from '../../_lib/request';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  q: z.string().min(1).max(200),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const GET = withErrorEnvelope('GET /api/geocode/autocomplete', async (req) => {
  // Autocomplete fires per keystroke, so it gets its own, larger budget.
  const limit = await enforceRateLimit(req, 'geocode');
  if (!limit.ok) return limit.response;

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    q: url.searchParams.get('q') ?? '',
    lat: url.searchParams.get('lat') ?? undefined,
    lng: url.searchParams.get('lng') ?? undefined,
  });
  if (!parsed.success) return apiError(400, 'BAD_REQUEST', 'Invalid query.');

  try {
    const bias =
      parsed.data.lat !== undefined && parsed.data.lng !== undefined
        ? { lat: parsed.data.lat, lng: parsed.data.lng }
        : undefined;
    const raw = await getGeocoder().autocomplete(parsed.data.q, bias);
    // Re-rank before the rider sees it: picking the wrong JFK changes the fare.
    const suggestions = rankSuggestions(parsed.data.q, raw);
    return NextResponse.json(
      { suggestions },
      { headers: { ...limit.headers, 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    logger.warn('geocode.autocomplete.failed', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    // An autocomplete failure degrades to "type it in full", never to a guess.
    return NextResponse.json(
      {
        suggestions: [],
        degraded: true,
        message: 'Address suggestions are unavailable. Type the full address and compare.',
      },
      { headers: limit.headers },
    );
  }
});
