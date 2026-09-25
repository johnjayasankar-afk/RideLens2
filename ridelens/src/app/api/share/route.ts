/**
 * POST /api/share — mint a share link for a route.
 *
 * The rider's explicit action is what puts a route into storage. The response
 * is an opaque id, never the coordinates, so the resulting URL is safe to paste
 * into a message, a log or a chat history.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig } from '@/config/env';
import { getShareStore } from '@/db/shareStore';
import { canonicalizeRoute, LocationInputSchema, RouteError } from '@/location/canonical';
import { apiError, withErrorEnvelope } from '../_lib/errors';
import { enforceRateLimit } from '../_lib/request';

export const dynamic = 'force-dynamic';

const Schema = z.object({
  pickup: LocationInputSchema,
  destination: LocationInputSchema,
});

export const POST = withErrorEnvelope('POST /api/share', async (req) => {
  const limit = await enforceRateLimit(req, 'share');
  if (!limit.ok) return limit.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, 'BAD_REQUEST', 'Body must be JSON.');
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError(400, 'BAD_REQUEST', 'Invalid route.');

  let route;
  try {
    route = await canonicalizeRoute(parsed.data.pickup, parsed.data.destination);
  } catch (err) {
    if (err instanceof RouteError) return apiError(422, err.code, err.message);
    return apiError(502, 'GEOCODER_UNAVAILABLE', 'Could not resolve those locations right now.');
  }

  const store = getShareStore();
  const shared = await store.create(route.pickup, route.destination);
  const base = getConfig().NEXT_PUBLIC_APP_URL.replace(/\/$/, '');

  return NextResponse.json(
    {
      id: shared.id,
      url: `${base}/s/${shared.id}`,
      expiresAt: shared.expiresAt,
      durable: store.durable,
    },
    { headers: limit.headers },
  );
});
