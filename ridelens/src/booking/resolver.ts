/**
 * BookingLinkResolver.
 *
 * Order of preference:
 *  1. A URL the source supplied — but ONLY after it passes the allowlist.
 *     A partner feed knows more than we do; an unvalidated URL is a redirect
 *     vulnerability, so trust is conditional, never assumed.
 *  2. A provider-specific deep link we construct from documented syntax.
 *  3. A generic handoff behind an interstitial that restates the route and the
 *     observed price, so the rider is never dropped into a blank app.
 */
import type { BookingHandoff, ProviderId } from '@/domain/quote';
import type { CanonicalLocation } from '@/location/types';
import { validateBookingUrl } from './allowlist';
import { buildCurbHandoff } from './providers/curb';
import { buildEmpowerHandoff } from './providers/empower';
import { buildLyftHandoff } from './providers/lyft';
import { buildUberHandoff } from './providers/uber';

export interface ResolveHandoffArgs {
  provider: ProviderId;
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  providerProductId: string | null;
  /** Untrusted. Validated before use; silently discarded if it fails. */
  sourceSuppliedUrl: string | null;
}

export function resolveBookingHandoff(args: ResolveHandoffArgs): BookingHandoff | null {
  if (args.sourceSuppliedUrl) {
    const verdict = validateBookingUrl(args.sourceSuppliedUrl, args.provider);
    if (verdict.ok) {
      return {
        kind: 'PARTIAL_DEEPLINK',
        url: args.sourceSuppliedUrl,
        prefilledFields: [],
        // The source says this link books the ride; we have not confirmed what
        // it prefills, so we claim nothing.
        prefillVerification: 'UNVERIFIED',
        note: 'Booking link supplied by the quote source.',
      };
    }
    // Rejected URL falls through to a constructed link. Never surfaced.
  }

  switch (args.provider) {
    case 'uber':
      return buildUberHandoff(args);
    case 'lyft':
      return buildLyftHandoff(args);
    case 'curb':
      return buildCurbHandoff();
    case 'empower':
      return buildEmpowerHandoff();
    case 'taxi':
      return {
        kind: 'INFO_ONLY',
        // A regulated taxi is hailed at the kerb or dispatched locally. There
        // is no single destination to send anyone to, and inventing one would
        // be worse than saying so.
        url: null,
        prefilledFields: [],
        prefillVerification: 'NOT_APPLICABLE',
        note: 'This is the regulated fare for a licensed taxi. Hail one at the kerb or use a licensed dispatch app in this city — the meter charges the same either way.',
      };
    case 'bikeshare':
      return {
        kind: 'INFO_ONLY',
        // Unlocking happens at the dock, in the operator's own app.
        url: null,
        prefilledFields: [],
        prefillVerification: 'NOT_APPLICABLE',
        note: 'Walk to the station shown and unlock the bike in the operator\u2019s app. Station availability changes minute to minute, so check before you set off.',
      };
    case 'transit':
      return {
        kind: 'INFO_ONLY',
        // Tickets are bought in the operator's own app or at the station. We
        // do not deep-link it: a link that lands on a generic homepage with
        // none of the trip filled in is a worse answer than naming the
        // station and letting the rider take it from there.
        url: null,
        prefilledFields: [],
        prefillVerification: 'NOT_APPLICABLE',
        note: 'Buy before you board \u2014 a ticket bought from the conductor costs several dollars more. The fare shown is the pre-boarding price.',
      };
    case 'waymo':
      return {
        kind: 'GENERIC',
        url: 'https://waymo.com/',
        prefilledFields: [],
        prefillVerification: 'NOT_APPLICABLE',
        note: 'Open Waymo One and enter the pickup and destination shown above.',
      };
    case 'other':
    default:
      return null;
  }
}

/** True when the UI must show the interstitial rather than link straight out. */
export function requiresInterstitial(handoff: BookingHandoff): boolean {
  return handoff.kind !== 'PREFILLED_DEEPLINK' || handoff.prefilledFields.length === 0;
}

/** True when there is nowhere to navigate — the sheet is the whole answer. */
export function isInfoOnly(handoff: BookingHandoff): boolean {
  return handoff.kind === 'INFO_ONLY' || handoff.url === null;
}
