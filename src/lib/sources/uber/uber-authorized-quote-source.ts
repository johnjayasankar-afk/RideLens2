import { randomUUID } from "crypto";
import { resolveBookingHandoff } from "@/lib/booking/booking-link-resolver";
import { getEnv } from "@/lib/config";
import { computeFreshness } from "@/lib/domain/freshness";
import { confidenceForQuoteType } from "@/lib/domain/ranking";
import { mapProductToCategory } from "@/lib/domain/taxonomy";
import type {
  NormalizedQuote,
  QuoteRequest,
  SourceCapabilities,
  SourceHealth,
  SourceQuoteResult,
} from "@/lib/domain/types";
import type { QuoteSource } from "@/lib/sources/types";
import { AuthorizationError } from "@/lib/sources/types";

/**
 * Uber Price Estimates API is restricted for competitive comparison
 * (Uber API Terms § II B). This adapter exists as a clean boundary and
 * stays disabled unless UBER_COMPARISON_AUTHORIZED=true AND credentials
 * exist under a written commercial agreement.
 */
export class UberAuthorizedQuoteSource implements QuoteSource {
  id = "uber_authorized";

  capabilities(): SourceCapabilities {
    const env = getEnv();
    const authorized = Boolean(env.UBER_COMPARISON_AUTHORIZED);
    return {
      supportsPrice: authorized,
      supportsUpfront: false,
      supportsETA: authorized,
      supportsBooking: true,
      supportsAccountLink: true,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ["US"],
      ttlSeconds: 15,
      rateLimitPerMinute: 30,
      comparisonPermitted: authorized,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const env = getEnv();
    if (!env.UBER_COMPARISON_AUTHORIZED) {
      return {
        sourceId: this.id,
        status: "disabled",
        p50LatencyMs: null,
        lastSuccessAt: null,
        lastError:
          "Competitive comparison not authorized under Uber API Terms § II B",
        providersSurfaced: [],
      };
    }
    return {
      sourceId: this.id,
      status: env.UBER_CLIENT_ID ? "healthy" : "misconfigured",
      p50LatencyMs: null,
      lastSuccessAt: null,
      lastError: env.UBER_CLIENT_ID
        ? null
        : "UBER_CLIENT_ID/SECRET required",
      providersSurfaced: ["uber"],
    };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const started = Date.now();
    const env = getEnv();
    if (!env.UBER_COMPARISON_AUTHORIZED) {
      return {
        sourceId: this.id,
        ok: false,
        quotes: [],
        latencyMs: Date.now() - started,
        failure: {
          sourceId: this.id,
          code: "COMPETITIVE_COMPARISON_RESTRICTED",
          message:
            "Uber Price Estimates API may not be used for competitive comparison without written authorization. Use a licensed aggregator (Obi) or obtain a commercial agreement.",
          retryable: false,
        },
      };
    }

    // Placeholder for authorized commercial integration path.
    // Intentionally does not call estimates.price without confirmed rights.
    void request;
    void AuthorizationError;
    return {
      sourceId: this.id,
      ok: false,
      quotes: [],
      latencyMs: Date.now() - started,
      failure: {
        sourceId: this.id,
        code: "NOT_IMPLEMENTED_PENDING_AGREEMENT",
        message:
          "Uber comparison flag set but commercial estimate endpoint integration awaits partner agreement details.",
        retryable: false,
      },
    };
  }
}

/** Normalize a hypothetical authorized Uber estimate payload (for tests). */
export function normalizeUberEstimateFixture(
  raw: {
    product_id: string;
    display_name: string;
    low_estimate: number;
    high_estimate: number;
    currency_code: string;
    duration?: number;
  },
  request: QuoteRequest,
): NormalizedQuote {
  const now = new Date();
  const receivedAt = now.toISOString();
  const min = raw.low_estimate * 100;
  const max = raw.high_estimate * 100;
  const priceType =
    min === max ? ("ESTIMATE" as const) : ("ESTIMATE_RANGE" as const);
  return {
    id: randomUUID(),
    provider: "uber",
    providerProductId: raw.product_id,
    providerProductName: raw.display_name,
    normalizedCategory: mapProductToCategory("uber", raw.display_name),
    priceType,
    priceMinMinor: min,
    priceMaxMinor: max,
    displayPriceMinor: Math.round((min + max) / 2),
    rankingPriceMinor: Math.round((min + max) / 2),
    currency: raw.currency_code || "USD",
    pickupEtaSeconds: null,
    tripDurationSeconds: raw.duration ? raw.duration * 60 : null,
    distanceMeters: null,
    availability: "AVAILABLE",
    source: "uber_authorized",
    sourceMethod: "authorized_direct",
    accountContext: request.accountContext,
    receivedAt,
    providerTimestamp: null,
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    freshness: computeFreshness(receivedAt, null, now),
    bookingHandoff: resolveBookingHandoff("uber", {
      pickup: request.pickup,
      destination: request.destination,
      productId: raw.product_id,
      productName: raw.display_name,
    }),
    confidenceClass: confidenceForQuoteType(priceType, min, max),
    metadata: {},
  };
}
