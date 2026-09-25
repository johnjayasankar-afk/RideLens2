/**
 * Curb booking handoff.
 *
 * Curb publishes no documented consumer deep-link parameter syntax. Until a
 * Curb Flow partner agreement supplies one (a partner integration would
 * normally return a booking URL in the quote payload, which the resolver
 * validates and prefers), we hand off generically and tell the rider exactly
 * what to re-enter.
 */
import type { BookingHandoff } from '@/domain/quote';

export function buildCurbHandoff(): BookingHandoff {
  return {
    kind: 'GENERIC',
    url: 'https://gocurb.com/',
    prefilledFields: [],
    prefillVerification: 'NOT_APPLICABLE',
    note: 'Curb does not publish a deep-link format. Open Curb and enter the pickup and destination shown above.',
  };
}
