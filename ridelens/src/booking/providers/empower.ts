/**
 * Empower booking handoff.
 *
 * Empower publishes no deep-link scheme or web booking flow, so this is always
 * a generic handoff with an explicit interstitial. We do not invent a URL
 * pattern and hope it works.
 */
import type { BookingHandoff } from '@/domain/quote';

export function buildEmpowerHandoff(): BookingHandoff {
  return {
    kind: 'GENERIC',
    url: 'https://www.rideempower.com/',
    prefilledFields: [],
    prefillVerification: 'NOT_APPLICABLE',
    note: 'Empower does not publish a deep-link format. Open Empower and enter the pickup and destination shown above.',
  };
}
