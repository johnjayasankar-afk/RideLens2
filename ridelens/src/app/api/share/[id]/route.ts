/**
 * GET /api/share/:id — resolve a share link back to its route.
 *
 * Returns the route only. Prices are never stored or replayed: the client
 * immediately runs a fresh comparison, because a fare from an hour ago is a
 * memory, not a price.
 */
import { NextResponse } from 'next/server';
import { getShareStore } from '@/db/shareStore';
import { isValidShareId } from '@/domain/share';
import { apiError } from '../../_lib/errors';
import { enforceRateLimit } from '../../_lib/request';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const limit = await enforceRateLimit(req, 'share_read');
  if (!limit.ok) return limit.response;

  const { id } = await ctx.params;
  if (!isValidShareId(id)) return apiError(400, 'BAD_REQUEST', 'Malformed share link.');

  const route = await getShareStore().resolve(id);
  if (!route) {
    return apiError(404, 'NOT_FOUND', 'That share link has expired or does not exist.');
  }

  return NextResponse.json(
    { pickup: route.pickup, destination: route.destination, createdAt: route.createdAt },
    { headers: { ...limit.headers, 'Cache-Control': 'no-store' } },
  );
}
