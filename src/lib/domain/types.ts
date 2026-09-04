export type ProviderId =
  | "uber"
  | "lyft"
  | "empower"
  | "curb"
  | "waymo"
  | "other";

export type RideCategory =
  | "STANDARD"
  | "ECONOMY"
  | "TAXI"
  | "XL"
  | "PREMIUM"
  | "LUXURY"
  | "EV"
  | "SHARED"
  | "ACCESSIBLE"
  | "AUTONOMOUS"
  | "OTHER";

export type QuoteType =
  | "UPFRONT_QUOTE"
  | "ESTIMATE"
  | "ESTIMATE_RANGE"
  | "METERED_ESTIMATE"
  | "UNKNOWN";

export type Freshness = "LIVE" | "RECENT" | "STALE" | "EXPIRED";

export type AccountContext = "PUBLIC" | "ACCOUNT_LINKED" | "UNKNOWN";

export type ConfidenceClass = "HIGH" | "MEDIUM" | "LOW" | "UNCERTAIN";

export type QuoteSessionStatus =
  | "PENDING"
  | "RUNNING"
  | "PARTIAL"
  | "SUCCESS"
  | "FAILED";

export type Availability = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";

export type RankingMode = "cheapest" | "fastest" | "best_value";

export type SourceMethod =
  | "licensed_aggregation"
  | "authorized_direct"
  | "partner_api"
  | "public_rate_card"
  | "fixture"
  | "unknown";

export interface CanonicalLocation {
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId?: string;
  name?: string;
  city?: string;
  region?: string;
  country?: string;
}

export interface BookingHandoff {
  kind: "deep_link" | "web" | "interstitial";
  url: string;
  prefills: {
    pickup: boolean;
    destination: boolean;
    product: boolean;
  };
  label: string;
  verified: boolean;
}

export interface NormalizedQuote {
  id: string;
  provider: ProviderId;
  providerProductId: string;
  providerProductName: string;
  normalizedCategory: RideCategory;
  priceType: QuoteType;
  priceMinMinor: number;
  priceMaxMinor: number;
  displayPriceMinor: number;
  rankingPriceMinor: number;
  currency: string;
  pickupEtaSeconds: number | null;
  tripDurationSeconds: number | null;
  distanceMeters: number | null;
  availability: Availability;
  source: string;
  sourceMethod: SourceMethod;
  accountContext: AccountContext;
  receivedAt: string;
  providerTimestamp: string | null;
  expiresAt: string | null;
  freshness: Freshness;
  bookingHandoff: BookingHandoff | null;
  confidenceClass: ConfidenceClass;
  metadata: Record<string, unknown>;
}

export interface SourceCapabilities {
  supportsPrice: boolean;
  supportsUpfront: boolean;
  supportsETA: boolean;
  supportsBooking: boolean;
  supportsAccountLink: boolean;
  supportsCurrentLocation: boolean;
  supportsScheduledRide: boolean;
  markets: string[];
  ttlSeconds: number;
  rateLimitPerMinute: number;
  comparisonPermitted: boolean;
}

export interface SourceHealth {
  sourceId: string;
  status: "healthy" | "degraded" | "down" | "disabled" | "misconfigured";
  p50LatencyMs: number | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  providersSurfaced: ProviderId[];
}

export interface QuoteRequest {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  accountContext: AccountContext;
  userId?: string;
  sessionId: string;
  signal?: AbortSignal;
}

export interface SourceFailure {
  sourceId: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface SourceQuoteResult {
  sourceId: string;
  ok: boolean;
  quotes: NormalizedQuote[];
  failure?: SourceFailure;
  latencyMs: number;
  raw?: unknown;
}

export interface Discrepancy {
  provider: ProviderId;
  category: RideCategory;
  quotes: NormalizedQuote[];
  deltaMinor: number;
  message: string;
}

export interface QuoteSessionCoverage {
  sourcesExpected: string[];
  sourcesSucceeded: string[];
  sourcesFailed: Array<{ sourceId: string; code: string; message: string }>;
  providersReturned: ProviderId[];
}

export interface QuoteSession {
  id: string;
  status: QuoteSessionStatus;
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  createdAt: string;
  updatedAt: string;
  coverage: QuoteSessionCoverage;
  quotes: NormalizedQuote[];
  discrepancies: Discrepancy[];
  rankingMode: RankingMode;
  categoryFilter: RideCategory[] | "ALL";
}

export interface PriceComparison {
  relation: "cheaper" | "more_expensive" | "similar" | "unclear";
  savingsMinor?: number;
  label: string;
}
