import { randomUUID } from "crypto";
import { resolveBookingHandoff } from "@/lib/booking/booking-link-resolver";
import { computeFreshness } from "@/lib/domain/freshness";
import { confidenceForQuoteType } from "@/lib/domain/ranking";
import type {
  NormalizedQuote,
  QuoteRequest,
  SourceCapabilities,
  SourceHealth,
  SourceQuoteResult,
} from "@/lib/domain/types";
import type { QuoteSource } from "@/lib/sources/types";

/** Test/demo fixtures only — never registered in production. */
export class FixtureQuoteSource implements QuoteSource {
  id = "fixture";

  capabilities(): SourceCapabilities {
    return {
      supportsPrice: true,
      supportsUpfront: true,
      supportsETA: true,
      supportsBooking: true,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ["test"],
      ttlSeconds: 10,
      rateLimitPerMinute: 1000,
      comparisonPermitted: true,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    return {
      sourceId: this.id,
      status: "healthy",
      p50LatencyMs: 5,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      providersSurfaced: ["uber", "lyft", "empower", "curb"],
    };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const started = Date.now();
    const now = new Date();
    const receivedAt = now.toISOString();

    const mk = (
      partial: Omit<
        NormalizedQuote,
        | "id"
        | "receivedAt"
        | "freshness"
        | "bookingHandoff"
        | "accountContext"
        | "source"
        | "sourceMethod"
        | "providerTimestamp"
        | "expiresAt"
        | "confidenceClass"
        | "metadata"
      > & { confidenceClass?: NormalizedQuote["confidenceClass"] },
    ): NormalizedQuote => ({
      id: randomUUID(),
      ...partial,
      source: this.id,
      sourceMethod: "fixture",
      accountContext: request.accountContext,
      receivedAt,
      providerTimestamp: null,
      expiresAt: new Date(now.getTime() + 120_000).toISOString(),
      freshness: computeFreshness(receivedAt, null, now),
      bookingHandoff: resolveBookingHandoff(partial.provider, {
        pickup: request.pickup,
        destination: request.destination,
        productId: partial.providerProductId,
        productName: partial.providerProductName,
      }),
      confidenceClass:
        partial.confidenceClass ??
        confidenceForQuoteType(
          partial.priceType,
          partial.priceMinMinor,
          partial.priceMaxMinor,
        ),
      metadata: { fixture: true },
    });

    const quotes: NormalizedQuote[] = [
      mk({
        provider: "empower",
        providerProductId: "empower_standard",
        providerProductName: "Empower Standard",
        normalizedCategory: "STANDARD",
        priceType: "ESTIMATE",
        priceMinMinor: 2384,
        priceMaxMinor: 2384,
        displayPriceMinor: 2384,
        rankingPriceMinor: 2384,
        currency: "USD",
        pickupEtaSeconds: 240,
        tripDurationSeconds: 1920,
        distanceMeters: 18000,
        availability: "AVAILABLE",
      }),
      mk({
        provider: "curb",
        providerProductId: "curb_taxi",
        providerProductName: "Curb Taxi",
        normalizedCategory: "TAXI",
        priceType: "UPFRONT_QUOTE",
        priceMinMinor: 2720,
        priceMaxMinor: 2720,
        displayPriceMinor: 2720,
        rankingPriceMinor: 2720,
        currency: "USD",
        pickupEtaSeconds: 180,
        tripDurationSeconds: 2100,
        distanceMeters: 18000,
        availability: "AVAILABLE",
      }),
      mk({
        provider: "lyft",
        providerProductId: "lyft",
        providerProductName: "Lyft",
        normalizedCategory: "STANDARD",
        priceType: "ESTIMATE_RANGE",
        priceMinMinor: 2892,
        priceMaxMinor: 3092,
        displayPriceMinor: 2992,
        rankingPriceMinor: 2992,
        currency: "USD",
        pickupEtaSeconds: 300,
        tripDurationSeconds: 1980,
        distanceMeters: 18000,
        availability: "AVAILABLE",
      }),
      mk({
        provider: "uber",
        providerProductId: "uberx",
        providerProductName: "UberX",
        normalizedCategory: "STANDARD",
        priceType: "ESTIMATE_RANGE",
        priceMinMinor: 3196,
        priceMaxMinor: 3396,
        displayPriceMinor: 3296,
        rankingPriceMinor: 3296,
        currency: "USD",
        pickupEtaSeconds: 120,
        tripDurationSeconds: 1860,
        distanceMeters: 18000,
        availability: "AVAILABLE",
      }),
      mk({
        provider: "uber",
        providerProductId: "uberxl",
        providerProductName: "UberXL",
        normalizedCategory: "XL",
        priceType: "ESTIMATE_RANGE",
        priceMinMinor: 4500,
        priceMaxMinor: 5200,
        displayPriceMinor: 4850,
        rankingPriceMinor: 4850,
        currency: "USD",
        pickupEtaSeconds: 360,
        tripDurationSeconds: 1860,
        distanceMeters: 18000,
        availability: "AVAILABLE",
      }),
    ];

    return {
      sourceId: this.id,
      ok: true,
      quotes,
      latencyMs: Date.now() - started,
    };
  }
}
