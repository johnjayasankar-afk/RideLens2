/**
 * Booking-link allowlist.
 *
 * A URL that arrives inside a provider payload is untrusted input. If a source
 * were compromised, or simply buggy, an unvalidated booking_url is an open
 * redirect that sends a rider — mid-purchase-intent — to an attacker's page.
 * Every URL that reaches a client passes through validateBookingUrl first.
 */
import { PROVIDER_PROFILES } from '@/config/providers';
import type { ProviderId } from '@/domain/quote';

/** Native app schemes we permit for a same-provider handoff. */
const ALLOWED_APP_SCHEMES: Readonly<Record<ProviderId, readonly string[]>> = {
  uber: ['uber'],
  lyft: ['lyft'],
  empower: [],
  curb: ['curbapp', 'curb'],
  taxi: [],
  bikeshare: [],
  transit: [],
  waymo: ['waymo'],
  other: [],
};

export interface UrlValidationResult {
  ok: boolean;
  reason?: string;
}

export function allowedHostsFor(provider: ProviderId): readonly string[] {
  return PROVIDER_PROFILES[provider]?.bookingHosts ?? [];
}

/**
 * A booking URL is acceptable only when it is HTTPS, has no credentials
 * embedded, and its host is exactly an allowlisted host for THAT provider —
 * suffix matching is deliberately not used, because `uber.com.evil.tld`
 * would pass a naive endsWith check.
 */
export function validateBookingUrl(url: string, provider: ProviderId): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'Malformed URL' };
  }

  if (parsed.protocol !== 'https:') return { ok: false, reason: 'Not HTTPS' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'Embedded credentials' };

  const host = parsed.hostname.toLowerCase();
  const allowed = allowedHostsFor(provider);
  if (!allowed.includes(host)) {
    return { ok: false, reason: `Host ${host} is not allowlisted for ${provider}` };
  }
  return { ok: true };
}

export function validateAppUrl(url: string, provider: ProviderId): UrlValidationResult {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!match) return { ok: false, reason: 'No scheme' };
  const scheme = (match[1] ?? '').toLowerCase();
  const allowed = ALLOWED_APP_SCHEMES[provider] ?? [];
  if (!allowed.includes(scheme)) {
    return { ok: false, reason: `Scheme ${scheme}: is not allowlisted for ${provider}` };
  }
  return { ok: true };
}

/** Flattened allowlist, used by the /api/handoff guard and by tests. */
export function allBookingHosts(): string[] {
  return Object.values(PROVIDER_PROFILES).flatMap((p) => p.bookingHosts);
}
