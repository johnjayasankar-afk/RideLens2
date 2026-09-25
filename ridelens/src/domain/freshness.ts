/**
 * Freshness is computed from wall-clock age at read time, never stored as a
 * fixed label — a quote that was LIVE when it was fetched becomes STALE while
 * it sits on screen, and the card must say so.
 */
import type { Freshness, NormalizedQuote } from './quote';

export interface FreshnessPolicy {
  /** Age below which a quote is LIVE. */
  liveMs: number;
  /** Age below which a quote is RECENT. */
  recentMs: number;
  /** Age beyond which a quote is EXPIRED even without a provider expiry. */
  staleMs: number;
}

/**
 * Defaults are deliberately tight. Rideshare prices move on surge cycles
 * measured in tens of seconds, so a 90-second-old number is not "current".
 */
export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  liveMs: 20_000,
  recentMs: 60_000,
  staleMs: 180_000,
};

export function computeFreshness(
  receivedAt: string,
  expiresAt: string | null,
  now: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): Freshness {
  const received = Date.parse(receivedAt);
  if (!Number.isFinite(received)) return 'EXPIRED';

  // A provider-declared expiry is authoritative and overrides age heuristics.
  if (expiresAt !== null) {
    const expires = Date.parse(expiresAt);
    if (Number.isFinite(expires) && now >= expires) return 'EXPIRED';
  }

  const age = now - received;
  if (age < 0) return 'LIVE'; // small clock skew; treat as just-received
  if (age <= policy.liveMs) return 'LIVE';
  if (age <= policy.recentMs) return 'RECENT';
  if (age <= policy.staleMs) return 'STALE';
  return 'EXPIRED';
}

export function refreshQuoteFreshness(
  quote: NormalizedQuote,
  now: number,
  policy?: FreshnessPolicy,
): NormalizedQuote {
  const freshness = computeFreshness(quote.receivedAt, quote.expiresAt, now, policy);
  return freshness === quote.freshness ? quote : { ...quote, freshness };
}

/** An EXPIRED quote is never presented as a current price. */
export function isPresentable(quote: NormalizedQuote): boolean {
  return quote.freshness !== 'EXPIRED';
}

export function formatAge(receivedAt: string, now: number): string {
  const ms = now - Date.parse(receivedAt);
  if (!Number.isFinite(ms) || ms < 0) return 'Just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 3) return 'Just now';
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} hr ago`;
}

/** "Quote expires in 1:24" — only rendered when the provider gave us an expiry. */
export function formatExpiry(expiresAt: string | null, now: number): string | null {
  if (expiresAt === null) return null;
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'Quote expired';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `Quote expires in ${m}:${String(s).padStart(2, '0')}`;
}

export const FRESHNESS_LABEL: Readonly<Record<Freshness, string>> = {
  LIVE: 'Live',
  RECENT: 'Recent',
  STALE: 'Stale',
  EXPIRED: 'Expired',
};
