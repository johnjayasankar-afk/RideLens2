/**
 * The RideLens quote model.
 *
 * Three orthogonal truth axes travel with every quote and are never inferred
 * at render time:
 *   - PriceType     what kind of number the provider gave us
 *   - Freshness     how old that number is right now
 *   - AccountContext whose price it is
 *
 * See docs/QUOTE_SEMANTICS.md for the normative definitions.
 */

import type { CanonicalLocation } from '@/location/types';

/** What the source actually promised. Never widen one of these upward. */
export const PRICE_TYPES = [
  /** Provider states a binding fare for this request. Honoured at booking. */
  'UPFRONT_QUOTE',
  /** Single-point prediction. May move before or after the ride. */
  'ESTIMATE',
  /** Low/high band. Both ends are real; the midpoint is not a price. */
  'ESTIMATE_RANGE',
  /** Meter-based service; the number models a meter outcome, not a fare. */
  'METERED_ESTIMATE',
  /** Source gave a number we cannot characterise. Never surfaced as a price. */
  'UNKNOWN',
] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const FRESHNESS_LEVELS = ['LIVE', 'RECENT', 'STALE', 'EXPIRED'] as const;
export type Freshness = (typeof FRESHNESS_LEVELS)[number];

export const ACCOUNT_CONTEXTS = [
  /** Public/anonymous market price. No rider identity applied. */
  'PUBLIC',
  /** Quote produced against this user's linked provider account. */
  'ACCOUNT_LINKED',
  /** Source did not tell us. Treated as PUBLIC for cache keying safety. */
  'UNKNOWN',
] as const;
export type AccountContext = (typeof ACCOUNT_CONTEXTS)[number];

export const AVAILABILITY = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type Availability = (typeof AVAILABILITY)[number];

/** How much we trust the number as a predictor of the final fare. */
export const CONFIDENCE_CLASSES = ['HIGH', 'MEDIUM', 'LOW', 'INDETERMINATE'] as const;
export type ConfidenceClass = (typeof CONFIDENCE_CLASSES)[number];

export const PROVIDERS = [
  'uber',
  'lyft',
  'empower',
  'curb',
  'taxi',
  'bikeshare',
  /** A scheduled public carrier: the fare is a published table, not a market. */
  'transit',
  'waymo',
  'other',
] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const SOURCE_IDS = [
  'obi',
  'uber_direct',
  'lyft_direct',
  'empower_direct',
  'curb_flow',
  'public_rate_card',
  'bikeshare_gbfs',
  'regional_rail',
  'demo_fixture',
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/** How the bytes reached us. Recorded so provenance is auditable. */
export const SOURCE_METHODS = [
  'AGGREGATOR_API',
  'DIRECT_PARTNER_API',
  'PERMITTED_PUBLIC_SURFACE',
  /** Computed from an official published tariff plus a measured route. */
  'PUBLISHED_TARIFF',
  /** An open real-time feed the operator publishes for exactly this purpose. */
  'OPEN_REALTIME_FEED',
  'LOCAL_FIXTURE',
] as const;
export type SourceMethod = (typeof SOURCE_METHODS)[number];

export const NORMALIZED_CATEGORIES = [
  'STANDARD',
  'ECONOMY',
  'TAXI',
  'XL',
  'PREMIUM',
  'LUXURY',
  'EV',
  'SHARED',
  'ACCESSIBLE',
  'AUTONOMOUS',
  /** A shared bike: a different mode, kept out of the vehicle comparison. */
  'BIKE',
  /** A scheduled train or bus. Also a different mode, and priced per rider. */
  'TRANSIT',
  'OTHER',
] as const;
export type NormalizedCategory = (typeof NORMALIZED_CATEGORIES)[number];

/** How a booking handoff was constructed — drives the UI's honesty about prefill. */
export const HANDOFF_KINDS = [
  'PREFILLED_DEEPLINK',
  'PARTIAL_DEEPLINK',
  'GENERIC',
  /**
   * Priceable, but there is nowhere to send the rider. A street-hailed taxi and
   * a docked bike are both booked in the physical world or in an operator app
   * we cannot deep-link. Inventing a destination would be worse than saying so.
   */
  'INFO_ONLY',
] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

/**
 * Whether a human has actually confirmed the prefill lands correctly in the
 * provider app. Defaults to UNVERIFIED — we do not claim prefill we have not seen.
 */
export const PREFILL_VERIFICATION = ['VERIFIED', 'UNVERIFIED', 'NOT_APPLICABLE'] as const;
export type PrefillVerification = (typeof PREFILL_VERIFICATION)[number];

export interface BookingHandoff {
  kind: HandoffKind;
  /**
   * Validated against the provider allowlist before it ever reaches a client.
   * Null for INFO_ONLY, where there is no destination to navigate to.
   */
  url: string | null;
  /** Native app link, when the provider documents one and it is allowlisted. */
  appUrl?: string;
  prefilledFields: Array<'pickup' | 'destination' | 'product'>;
  prefillVerification: PrefillVerification;
  /** Shown on the interstitial when kind === 'GENERIC'. */
  note?: string;
}

export interface NormalizedQuote {
  id: string;
  provider: ProviderId;
  /** Provider's own product identifier, verbatim. Used for reconciliation. */
  providerProductId: string;
  providerProductName: string;
  normalizedCategory: NormalizedCategory;

  priceType: PriceType;
  /** Low end in minor units. Equals priceMaxMinor for point prices. */
  priceMinMinor: number;
  priceMaxMinor: number;
  /**
   * What the UI prints. For a range this is priceMinMinor and the UI renders
   * both ends; it is never a synthesised midpoint.
   */
  displayPriceMinor: number;
  /** Sorting key only. May be a midpoint. NEVER rendered as a price. */
  rankingPriceMinor: number;
  currency: string;

  pickupEtaSeconds: number | null;
  /** Provider's own trip duration. Null unless the provider supplied it. */
  tripDurationSeconds: number | null;
  distanceMeters: number | null;

  availability: Availability;
  source: SourceId;
  sourceMethod: SourceMethod;
  accountContext: AccountContext;

  /** When RideLens received it. */
  receivedAt: string;
  /** Provider's own timestamp, when supplied. */
  providerTimestamp: string | null;
  /** Provider-declared expiry. Null when the source does not commit to one. */
  expiresAt: string | null;
  freshness: Freshness;
  /**
   * The instant this price is *for*, when that is not now.
   *
   * A regulated fare is a published rule, so a trip next Tuesday at 6:20am is
   * priceable today with the same certainty as one leaving in a minute — the
   * tariff says what it says. Setting this marks a quote as that kind of
   * answer, and it changes what the interface may claim about it: a projection
   * is not "live", it does not expire in ninety seconds, and refreshing it
   * every thirty seconds achieves nothing.
   *
   * Null on every quote priced for now, which is all of them until a rider
   * asks otherwise. A source that cannot honestly project — bike share reads
   * live station counts, and nobody knows which docks will have bikes on
   * Tuesday — returns no quote at all rather than one with this field set.
   */
  scheduledFor: string | null;

  bookingHandoff: BookingHandoff | null;
  confidenceClass: ConfidenceClass;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export type SessionStatus = 'PENDING' | 'RUNNING' | 'PARTIAL' | 'SUCCESS' | 'FAILED';

export interface SourceOutcome {
  sourceId: SourceId;
  status: 'OK' | 'TIMEOUT' | 'ERROR' | 'SKIPPED' | 'UNAUTHORIZED' | 'RATE_LIMITED';
  latencyMs: number | null;
  quoteCount: number;
  /** Operator-facing message. Never contains credentials or raw coordinates. */
  message: string | null;
  /** Set when the source is deliberately off (missing credential, policy gate). */
  blockerCode: string | null;
  cacheHit: boolean;
}

export interface QuoteSessionCoverage {
  sourcesExpected: SourceId[];
  sourcesSucceeded: SourceId[];
  sourcesFailed: SourceId[];
  providersReturned: ProviderId[];
}

export interface QuoteSession {
  id: string;
  status: SessionStatus;
  createdAt: string;
  completedAt: string | null;
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  coverage: QuoteSessionCoverage;
  outcomes: SourceOutcome[];
  /** Canonical, reconciled, ranked quotes. */
  quotes: NormalizedQuote[];
  /** Every normalized candidate before reconciliation, kept for debugging. */
  candidates: NormalizedQuote[];
  discrepancies: SourceDiscrepancy[];
}

export interface SourceDiscrepancy {
  provider: ProviderId;
  normalizedCategory: NormalizedCategory;
  /** Chosen quote id. */
  canonicalQuoteId: string;
  /** Rejected candidates that disagreed materially. */
  conflictingQuoteIds: string[];
  /** Absolute spread between the extreme ranking prices, in minor units. */
  spreadMinor: number;
  spreadBps: number;
  currency: string;
  severity: 'MINOR' | 'MATERIAL';
}
