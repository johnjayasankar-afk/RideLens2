/**
 * Uber booking handoff.
 *
 * Uber's current universal link is https://m.uber.com/looking with pickup and
 * drop[0] carrying URL-encoded JSON location objects, and client_id required.
 *
 * We only build the prefilled link when UBER_DEEPLINK_CLIENT_ID is configured.
 * Without it the parameters are not honoured, so claiming "pickup prefilled"
 * would be false — we degrade to a generic handoff and say so on the
 * interstitial instead.
 */
import { getConfig } from '@/config/env';
import type { BookingHandoff } from '@/domain/quote';
import type { CanonicalLocation } from '@/location/types';

const UNIVERSAL_BASE = 'https://m.uber.com/looking';

function locationObject(loc: CanonicalLocation) {
  return {
    latitude: loc.lat,
    longitude: loc.lng,
    addressLine1: loc.name,
    addressLine2: loc.formattedAddress,
  };
}

export function buildUberHandoff(args: {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  providerProductId: string | null;
}): BookingHandoff {
  const clientId = getConfig().UBER_DEEPLINK_CLIENT_ID;

  if (!clientId) {
    return {
      kind: 'GENERIC',
      url: 'https://m.uber.com/',
      prefilledFields: [],
      prefillVerification: 'NOT_APPLICABLE',
      note: 'Uber deep-link attribution is not configured, so pickup and destination cannot be prefilled. Enter them in the Uber app.',
    };
  }

  const url = new URL(UNIVERSAL_BASE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('pickup', JSON.stringify(locationObject(args.pickup)));
  url.searchParams.set('drop[0]', JSON.stringify(locationObject(args.destination)));

  const prefilled: BookingHandoff['prefilledFields'] = ['pickup', 'destination'];
  // Uber product ids are UUIDs; anything else is not a product_id and is dropped.
  if (args.providerProductId && /^[0-9a-f-]{36}$/i.test(args.providerProductId)) {
    url.searchParams.set('product_id', args.providerProductId);
    prefilled.push('product');
  }

  return {
    kind: 'PREFILLED_DEEPLINK',
    url: url.toString(),
    prefilledFields: prefilled,
    // Set to VERIFIED only after a human confirms the prefill in the Uber app.
    prefillVerification: 'UNVERIFIED',
  };
}
