/**
 * POST /api/handoff — validate a booking destination and record the event.
 *
 * The client never navigates to a URL it received from a quote payload
 * directly. It posts the intent here; the server re-validates the URL against
 * the provider allowlist and returns the URL only if it passes. This closes
 * the open-redirect path even if a source is compromised or a client is
 * tampered with.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBookingUrl } from '@/booking/allowlist';
import { getRepository, persistInBackground } from '@/db/repository';
import { PROVIDERS } from '@/domain/quote';
import { logger } from '@/observability/logger';
import { apiError, withErrorEnvelope } from '../_lib/errors';
import { enforceRateLimit } from '../_lib/request';

export const dynamic = 'force-dynamic';

const Schema = z.object({
  provider: z.enum(PROVIDERS),
  url: z.string().url().max(2000),
  quoteKey: z.string().max(200),
  sessionId: z.string().max(100).nullish(),
  handoffKind: z.enum(['PREFILLED_DEEPLINK', 'PARTIAL_DEEPLINK', 'GENERIC']),
  observedPriceMinor: z.number().int().nullish(),
  currency: z.string().length(3).nullish(),
  quoteAgeMs: z.number().int().min(0).nullish(),
});

export const POST = withErrorEnvelope('POST /api/handoff', async (req) => {
  const limit = await enforceRateLimit(req, 'handoff');
  if (!limit.ok) return limit.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, 'BAD_REQUEST', 'Body must be JSON.');
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError(400, 'BAD_REQUEST', 'Invalid handoff request.');

  const { provider, url } = parsed.data;
  const verdict = validateBookingUrl(url, provider);
  if (!verdict.ok) {
    logger.warn('handoff.rejected', { provider, reason: verdict.reason ?? 'unknown' });
    return apiError(
      400,
      'DESTINATION_NOT_ALLOWED',
      'That booking destination is not an allowlisted provider domain.',
    );
  }

  const host = new URL(url).hostname;
  persistInBackground(
    () =>
      getRepository().recordHandoff({
        sessionId: parsed.data.sessionId ?? null,
        userId: null,
        provider,
        quoteKey: parsed.data.quoteKey,
        handoffKind: parsed.data.handoffKind,
        destinationHost: host,
        observedPriceMinor: parsed.data.observedPriceMinor ?? null,
        currency: parsed.data.currency ?? null,
        quoteAgeMs: parsed.data.quoteAgeMs ?? null,
      }),
    'recordHandoff',
  );

  return NextResponse.json({ url, host }, { headers: limit.headers });
});
