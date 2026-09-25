/** Shared request helpers for the API routes. */
import { NextResponse } from 'next/server';
import { getConfig } from '@/config/env';
import { clientKey, getRateLimiter } from '@/orchestration/ratelimit';

/**
 * Per-bucket budgets, expressed as multiples of RATE_LIMIT_MAX_REQUESTS rather
 * than magic numbers scattered through route handlers.
 *
 * The ratios reflect how often each action legitimately fires: autocomplete
 * runs per keystroke, a comparison runs per deliberate search. Tuning the base
 * therefore moves every bucket together, which is what an operator actually
 * wants.
 */
export const BUCKET_MULTIPLIER: Readonly<Record<string, number>> = {
  compare: 1,
  share: 1,
  admin: 1,
  handoff: 2,
  route: 2,
  share_read: 4,
  geocode: 6,
};

export function bucketLimit(bucket: string, base: number): number {
  return Math.max(1, Math.round(base * (BUCKET_MULTIPLIER[bucket] ?? 1)));
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return (fwd.split(',')[0] ?? '').trim() || null;
  return req.headers.get('x-real-ip');
}

/**
 * Discriminated so a refusal is guaranteed to carry its response. Without the
 * union, `limit.response` is `NextResponse | undefined` and every route handler
 * silently widens to a possibly-undefined return type.
 */
export type LimitDecision =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; headers: Record<string, string>; response: NextResponse };

/**
 * Server-side rate limiting. Client timers are never trusted; this is the only
 * enforcement point.
 */
export async function enforceRateLimit(
  req: Request,
  bucket: string,
  limitOverride?: number,
): Promise<LimitDecision> {
  const cfg = getConfig();
  const limit = limitOverride ?? bucketLimit(bucket, cfg.RATE_LIMIT_MAX_REQUESTS);
  const key = await clientKey(bucket, clientIp(req));
  const result = await getRateLimiter().check(key, limit, cfg.RATE_LIMIT_WINDOW_SECONDS);

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };

  if (!result.allowed) {
    return {
      ok: false,
      headers,
      response: NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message: 'Too many comparisons from this network. Try again shortly.',
        },
        {
          status: 429,
          headers: {
            ...headers,
            'Retry-After': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
          },
        },
      ),
    };
  }
  return { ok: true, headers };
}
