/**
 * The source abstraction.
 *
 * A *source* is where bytes come from (Obi, a direct partner API, a fixture).
 * A *provider* is the brand a rider books (Uber, Lyft, Empower, Curb). One
 * source can yield many providers; one provider can arrive from many sources.
 * Keeping the two apart is what makes reconciliation and honest provenance
 * possible.
 */
import type { CanonicalLocation } from '@/location/types';
import type { NormalizedQuote, ProviderId, SourceId, SourceMethod } from '@/domain/quote';

export interface QuoteRequest {
  sessionId: string;
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  /** Present only when the user linked this provider account. */
  accountLinks?: Partial<Record<ProviderId, { accessToken: string }>>;
  /**
   * How many people are travelling. Affects the price only where a city
   * publishes a per-passenger charge; everywhere else it is inert.
   */
  partySize: number;
  /**
   * Price the trip for this instant instead of now.
   *
   * Only sources whose price is a published rule may honour it. Everything
   * else must decline: a live feed cannot be read in the future, and a
   * market-priced provider's fare next Tuesday is a forecast.
   */
  departAt?: Date;
  /** Per-source deadline enforced by the orchestrator as well as the adapter. */
  timeoutMs: number;
  signal?: AbortSignal;
  locale: string;
}

export interface SourceQuoteResult {
  sourceId: SourceId;
  quotes: NormalizedQuote[];
  /** Providers this source attempted, whether or not it returned quotes. */
  providersAttempted: ProviderId[];
  fetchedAt: string;
  latencyMs: number;
  /** Non-fatal notes, e.g. "Lyft omitted from this response". */
  warnings: string[];
}

export type SourceHealthStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'BLOCKED_BY_POLICY';

export interface SourceHealth {
  sourceId: SourceId;
  status: SourceHealthStatus;
  /** Operator-facing detail. Never contains secrets. */
  detail: string;
  checkedAt: string;
  latencyMs: number | null;
  /** Stable code an operator can search for in SETUP_REQUIRED.md. */
  blockerCode: string | null;
}

export interface SourceCapabilities {
  sourceId: SourceId;
  sourceMethod: SourceMethod;
  displayName: string;
  /** Providers this source can surface once enabled. */
  providers: ProviderId[];

  supportsPrice: boolean;
  supportsUpfront: boolean;
  supportsETA: boolean;
  supportsBooking: boolean;
  supportsAccountLink: boolean;
  supportsCurrentLocation: boolean;
  supportsScheduledRide: boolean;

  /** ISO country codes, or ['*'] for global. */
  markets: string[];
  /** Cache TTL this source's terms permit, in seconds. */
  cacheTtlSeconds: number;
  rateLimit: { requestsPerMinute: number; burst: number } | null;
}

/**
 * Why a source is not running. Distinguishing these matters: a missing key is
 * an operator action, a policy block is a legal/contractual decision, and an
 * absent endpoint means no amount of configuration will help.
 */
export type BlockerCode =
  | 'MISSING_CREDENTIAL'
  | 'PARTNER_APPROVAL_REQUIRED'
  | 'POLICY_PROHIBITED'
  | 'NO_PUBLIC_ENDPOINT'
  | 'NON_PRODUCTION_ONLY'
  | null;

export interface SourceEnablement {
  enabled: boolean;
  blockerCode: BlockerCode;
  /** Shown verbatim in the admin dashboard and in source-error UI. */
  blockerMessage: string | null;
  /** Env var(s) that would unblock it, if any. */
  requiredEnv: string[];
}

export interface QuoteSource {
  capabilities(): SourceCapabilities;
  /** Evaluated per-request from config; never cached across config changes. */
  enablement(): SourceEnablement;
  getQuotes(request: QuoteRequest): Promise<SourceQuoteResult>;
  healthCheck(): Promise<SourceHealth>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly sourceId: SourceId,
    readonly kind: 'TIMEOUT' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'UPSTREAM' | 'SCHEMA' | 'DISABLED',
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
