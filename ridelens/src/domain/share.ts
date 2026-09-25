/**
 * Shareable comparison links.
 *
 * The privacy constraint shapes the design. docs/SECURITY.md forbids putting
 * coordinates in a URL — they leak into access logs, referer headers and
 * browser history. So a share link carries an OPAQUE ID, and the route lives
 * server-side, created only by an explicit "Share" action.
 *
 * A shared link never carries prices. Opening one re-runs the comparison live,
 * because a fare from an hour ago is not a fare — it is a memory.
 */
import { randomBytes } from 'node:crypto';
import type { CanonicalLocation } from '@/location/types';

export interface SharedRoute {
  id: string;
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  createdAt: string;
  expiresAt: string;
}

/** Shared routes are ephemeral by design; location history should not accrete. */
export const SHARE_TTL_DAYS = 30;

/**
 * 12 chars of base32hex from 60 bits of entropy — short enough to paste into a
 * message, far too large to enumerate.
 */
export function newShareId(): string {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford-ish, no i/l/o/u
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += alphabet[(bytes[i] as number) % alphabet.length];
  }
  return out;
}

export function isValidShareId(id: string): boolean {
  return /^[0-9abcdefghjkmnpqrstvwxyz]{12}$/.test(id);
}

export function shareExpiry(now = Date.now()): string {
  return new Date(now + SHARE_TTL_DAYS * 86_400_000).toISOString();
}

export function isExpired(route: SharedRoute, now = Date.now()): boolean {
  const t = Date.parse(route.expiresAt);
  return Number.isFinite(t) && now >= t;
}

/**
 * Plain-text trip summary for the clipboard — the shape someone actually wants
 * when expensing a ride or texting a colleague. No price is included unless the
 * caller passes one, and it is always labelled with its semantics and age.
 */
export function tripSummary(args: {
  pickup: string;
  destination: string;
  provider?: string;
  product?: string;
  price?: string;
  priceQualifier?: string;
  observedAt?: string;
  shareUrl?: string;
}): string {
  const lines = [`Pickup: ${args.pickup}`, `Destination: ${args.destination}`];
  if (args.provider) {
    lines.push(`Ride: ${args.provider}${args.product ? ` ${args.product}` : ''}`);
  }
  if (args.price) {
    lines.push(
      `Observed price: ${args.price}${args.priceQualifier ? ` (${args.priceQualifier})` : ''}`,
    );
  }
  if (args.observedAt) lines.push(`Observed at: ${args.observedAt}`);
  lines.push('Final fare is confirmed in the provider app.');
  if (args.shareUrl) lines.push('', `Compare live: ${args.shareUrl}`);
  return lines.join('\n');
}
