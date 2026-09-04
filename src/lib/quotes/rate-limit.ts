import { getEnv } from "@/lib/config";

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; retryAfterSeconds: number };

export function rateLimit(
  key: string,
  max?: number,
  windowSeconds?: number,
): RateLimitResult {
  const env = getEnv();
  const limit = max ?? env.RATE_LIMIT_MAX_REQUESTS;
  const windowMs = (windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS) * 1000;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0]!;
    const retryAfterSeconds = Math.ceil((windowMs - (now - oldest)) / 1000);
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: limit - bucket.timestamps.length };
}

export function rateLimitKey(parts: {
  ip?: string;
  userId?: string;
  action: string;
}): string {
  if (parts.userId) return `user:${parts.userId}:${parts.action}`;
  return `anon:${parts.ip || "unknown"}:${parts.action}`;
}

export function resetRateLimits(): void {
  buckets.clear();
}
