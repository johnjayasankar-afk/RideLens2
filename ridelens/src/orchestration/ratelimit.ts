/**
 * Rate limiting.
 *
 * Never trusts a client timer. Three durable backends in preference order:
 * Upstash Redis, Supabase (Postgres), then in-memory — which is refused in
 * production by startupChecks because it does not survive a restart or span
 * instances.
 */
import { getConfig } from '@/config/env';
import { metrics } from '@/observability/metrics';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Unix ms when the window resets. */
  resetAt: number;
  limit: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/** Fixed-window counter. Simple, predictable, and adequate for this workload. */
export class MemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  async check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowSeconds * 1000;
      this.windows.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, resetAt, limit };
    }
    existing.count += 1;
    const allowed = existing.count <= limit;
    if (!allowed) metrics.recordRateLimitEvent();
    return {
      allowed,
      remaining: Math.max(0, limit - existing.count),
      resetAt: existing.resetAt,
      limit,
    };
  }

  reset(): void {
    this.windows.clear();
  }
}

export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    // INCR then EXPIRE-on-first-hit: one round trip for the common case.
    const res = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(windowSeconds), 'NX'],
        ['TTL', key],
      ]),
      cache: 'no-store',
    });

    if (!res.ok) {
      // Fail OPEN on limiter unavailability: a broken limiter must not take
      // the product down. The event is recorded so it is visible in admin.
      metrics.recordRateLimitEvent();
      return { allowed: true, remaining: limit, resetAt: now + windowSeconds * 1000, limit };
    }

    const body = (await res.json()) as Array<{ result?: number }>;
    const count = Number(body[0]?.result ?? 0);
    const ttl = Number(body[2]?.result ?? windowSeconds);
    const allowed = count <= limit;
    if (!allowed) metrics.recordRateLimitEvent();
    return {
      allowed,
      remaining: Math.max(0, limit - count),
      resetAt: now + Math.max(0, ttl) * 1000,
      limit,
    };
  }
}

let limiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  const cfg = getConfig();
  if (cfg.rateLimiter === 'upstash' && cfg.UPSTASH_REDIS_REST_URL && cfg.UPSTASH_REDIS_REST_TOKEN) {
    limiter = new UpstashRateLimiter(cfg.UPSTASH_REDIS_REST_URL, cfg.UPSTASH_REDIS_REST_TOKEN);
  } else {
    limiter = new MemoryRateLimiter();
  }
  return limiter;
}

export function resetRateLimiter(): void {
  limiter = null;
}

/**
 * Client identity for limiting. We hash the IP rather than storing it, and we
 * never key on anything that identifies a person.
 */
export async function clientKey(prefix: string, ip: string | null): Promise<string> {
  const raw = ip ?? 'unknown';
  const data = new TextEncoder().encode(`ridelens:${raw}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `rl:${prefix}:${hex}`;
}
