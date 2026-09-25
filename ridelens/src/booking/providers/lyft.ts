/**
 * Lyft booking handoff.
 *
 * Lyft's universal link is https://lyft.com/ride with bracketed pickup and
 * destination coordinates, `id` selecting the ride type and `partner` carrying
 * the client id. Riders without the app land on ride.lyft.com.
 *
 * As with Uber, the prefilled form is only built when a partner id exists.
 */
import { getConfig } from '@/config/env';
import type { BookingHandoff } from '@/domain/quote';
import type { CanonicalLocation } from '@/location/types';

const BASE = 'https://lyft.com/ride';

export function buildLyftHandoff(args: {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  providerProductId: string | null;
}): BookingHandoff {
  const partner = getConfig().LYFT_CLIENT_ID;

  if (!partner) {
    return {
      kind: 'GENERIC',
      url: 'https://ride.lyft.com/',
      prefilledFields: [],
      prefillVerification: 'NOT_APPLICABLE',
      note: 'Lyft deep-link attribution is not configured, so pickup and destination cannot be prefilled. Enter them in the Lyft app.',
    };
  }

  const url = new URL(BASE);
  url.searchParams.set('partner', partner);
  const prefilled: BookingHandoff['prefilledFields'] = ['pickup', 'destination'];
  if (args.providerProductId) {
    url.searchParams.set('id', args.providerProductId);
    prefilled.push('product');
  } else {
    url.searchParams.set('id', 'lyft');
  }
  url.searchParams.set('pickup[latitude]', args.pickup.lat.toFixed(6));
  url.searchParams.set('pickup[longitude]', args.pickup.lng.toFixed(6));
  url.searchParams.set('destination[latitude]', args.destination.lat.toFixed(6));
  url.searchParams.set('destination[longitude]', args.destination.lng.toFixed(6));

  return {
    kind: 'PREFILLED_DEEPLINK',
    url: url.toString(),
    prefilledFields: prefilled,
    prefillVerification: 'UNVERIFIED',
  };
}
