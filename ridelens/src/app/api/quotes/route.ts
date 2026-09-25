/**
 * POST /api/quotes — run one comparison and return the settled session.
 *
 * Non-streaming path, used by tests and by clients that prefer a single
 * response. The streaming path is /api/quotes/stream.
 */
import { NextResponse } from 'next/server';
import { getConfig } from '@/config/env';
import { getRepository, persistInBackground } from '@/db/repository';
import { canonicalizeRoute, RouteError } from '@/location/canonical';
import { CompareRequestSchema } from '../_lib/schemas';

export { CompareRequestSchema };
import { runQuoteSession } from '@/orchestration/engine';
import { enabledSources } from '@/sources/registry';
import { apiError, withErrorEnvelope } from '../_lib/errors';
import { enforceRateLimit } from '../_lib/request';

export const dynamic = 'force-dynamic';

/*
 * The orchestrator budgets QUOTE_REQUEST_TIMEOUT_MS (8s by default) for
 * upstream calls and enforces its own deadline. Serverless platforms default
 * to around ten seconds, which would kill a slow-but-succeeding comparison a
 * moment before it answered. Thirty leaves room for the deadline to do its job
 * and report what arrived.
 */
export const maxDuration = 30;

export const POST = withErrorEnvelope('POST /api/quotes', async (req) => {
  const limit = await enforceRateLimit(req, 'compare');
  if (!limit.ok) return limit.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, 'BAD_REQUEST', 'Body must be JSON.');
  }

  const parsed = CompareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  const cfg = getConfig();

  if (enabledSources().length === 0) {
    // Explicit and honest: no source means no prices, not empty cards.
    return apiError(
      503,
      'NO_SOURCE_CONFIGURED',
      'No quote source is currently enabled, so RideLens cannot show live prices. See /api/health for the exact blocker.',
      limit.headers,
    );
  }

  let route;
  try {
    route = await canonicalizeRoute(parsed.data.pickup, parsed.data.destination);
  } catch (err) {
    if (err instanceof RouteError) return apiError(422, err.code, err.message);
    return apiError(502, 'GEOCODER_UNAVAILABLE', 'Could not resolve those locations right now.');
  }

  const session = await runQuoteSession({
    pickup: route.pickup,
    destination: route.destination,
    locale: parsed.data.locale ?? 'en-US',
    partySize: parsed.data.partySize ?? 1,
    departAt: parsed.data.departAt ? new Date(parsed.data.departAt) : undefined,
    timeoutMs: cfg.QUOTE_REQUEST_TIMEOUT_MS,
    forceRefresh: parsed.data.refresh === true,
  });

  persistInBackground(() => getRepository().saveSession(session, {}), 'saveSession');

  return NextResponse.json(session, {
    headers: { ...limit.headers, 'Cache-Control': 'no-store' },
  });
});
