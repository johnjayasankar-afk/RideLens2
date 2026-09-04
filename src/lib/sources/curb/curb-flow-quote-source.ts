import { randomUUID } from "crypto";
import { resolveBookingHandoff } from "@/lib/booking/booking-link-resolver";
import { getEnv } from "@/lib/config";
import { computeFreshness } from "@/lib/domain/freshness";
import { dollarsToMinor } from "@/lib/domain/money";
import { confidenceForQuoteType } from "@/lib/domain/ranking";
import type {
  NormalizedQuote,
  QuoteRequest,
  SourceCapabilities,
  SourceHealth,
  SourceQuoteResult,
} from "@/lib/domain/types";
import type { QuoteSource } from "@/lib/sources/types";
import { z } from "zod";

/**
 * Curb Flow is primarily a supply-side demand network for taxi fleets.
 * Consumer upfront quotes require Curb Business / partner API access.
 * This adapter calls CURB_API_BASE_URL when configured.
 */
const curbQuoteSchema = z.object({
  quotes: z
    .array(
      z.object({
        id: z.string().optional(),
        product_name: z.string().default("Curb Taxi"),
        product_id: z.string().optional(),
        fare_amount: z.number(),
        currency: z.string().default("USD"),
        upfront: z.boolean().default(true),
        eta_seconds: z.number().nullable().optional(),
        available: z.boolean().default(true),
      }),
    )
    .default([]),
});

export class CurbFlowQuoteSource implements QuoteSource {
  id = "curb_flow";

  capabilities(): SourceCapabilities {
    const env = getEnv();
    const ok = Boolean(env.CURB_API_KEY && env.CURB_API_BASE_URL);
    return {
      supportsPrice: ok,
      supportsUpfront: ok,
      supportsETA: ok,
      supportsBooking: true,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: true,
      markets: ["US", "UK", "CA"],
      ttlSeconds: 25,
      rateLimitPerMinute: 40,
      comparisonPermitted: ok,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const env = getEnv();
    if (!env.CURB_API_KEY || !env.CURB_API_BASE_URL) {
      return {
        sourceId: this.id,
        status: "misconfigured",
        p50LatencyMs: null,
        lastSuccessAt: null,
        lastError:
          "Curb partner quote API required. Curb Flow is supply-side; set CURB_API_KEY + CURB_API_BASE_URL after Business/partner access.",
        providersSurfaced: [],
      };
    }
    return {
      sourceId: this.id,
      status: "healthy",
      p50LatencyMs: null,
      lastSuccessAt: null,
      lastError: null,
      providersSurfaced: ["curb"],
    };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const started = Date.now();
    const env = getEnv();
    if (!env.CURB_API_KEY || !env.CURB_API_BASE_URL) {
      return {
        sourceId: this.id,
        ok: false,
        quotes: [],
        latencyMs: Date.now() - started,
        failure: {
          sourceId: this.id,
          code: "PARTNER_ACCESS_REQUIRED",
          message:
            "Curb consumer quote API requires partner credentials (CURB_API_KEY, CURB_API_BASE_URL).",
          retryable: false,
        },
      };
    }

    try {
      const base = env.CURB_API_BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/v1/quotes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CURB_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pickup: {
            latitude: request.pickup.lat,
            longitude: request.pickup.lng,
            address: request.pickup.formattedAddress,
          },
          destination: {
            latitude: request.destination.lat,
            longitude: request.destination.lng,
            address: request.destination.formattedAddress,
          },
        }),
        signal: request.signal,
      });

      if (!res.ok) {
        return {
          sourceId: this.id,
          ok: false,
          quotes: [],
          latencyMs: Date.now() - started,
          failure: {
            sourceId: this.id,
            code: `HTTP_${res.status}`,
            message: `Curb quote failed: ${res.status}`,
            retryable: res.status >= 500,
          },
        };
      }

      const json = await res.json();
      const parsed = curbQuoteSchema.safeParse(json);
      if (!parsed.success) {
        return {
          sourceId: this.id,
          ok: false,
          quotes: [],
          latencyMs: Date.now() - started,
          failure: {
            sourceId: this.id,
            code: "SCHEMA_INVALID",
            message: "Curb response failed validation",
            retryable: false,
          },
          raw: json,
        };
      }

      const now = new Date();
      const receivedAt = now.toISOString();
      const quotes: NormalizedQuote[] = parsed.data.quotes.map((q) => {
        const minor = dollarsToMinor(q.fare_amount);
        const priceType = q.upfront
          ? ("UPFRONT_QUOTE" as const)
          : ("ESTIMATE" as const);
        return {
          id: randomUUID(),
          provider: "curb" as const,
          providerProductId: q.product_id || q.id || "curb_taxi",
          providerProductName: q.product_name,
          normalizedCategory: "TAXI" as const,
          priceType,
          priceMinMinor: minor,
          priceMaxMinor: minor,
          displayPriceMinor: minor,
          rankingPriceMinor: minor,
          currency: q.currency,
          pickupEtaSeconds: q.eta_seconds ?? null,
          tripDurationSeconds: null,
          distanceMeters: null,
          availability: q.available ? "AVAILABLE" : "UNAVAILABLE",
          source: this.id,
          sourceMethod: "partner_api" as const,
          accountContext: request.accountContext,
          receivedAt,
          providerTimestamp: null,
          expiresAt: new Date(now.getTime() + 120_000).toISOString(),
          freshness: computeFreshness(receivedAt, null, now),
          bookingHandoff: resolveBookingHandoff("curb", {
            pickup: request.pickup,
            destination: request.destination,
            productName: q.product_name,
          }),
          confidenceClass: confidenceForQuoteType(priceType, minor, minor),
          metadata: { curbUpfront: q.upfront },
        };
      });

      return {
        sourceId: this.id,
        ok: true,
        quotes,
        latencyMs: Date.now() - started,
        raw: json,
      };
    } catch (e) {
      return {
        sourceId: this.id,
        ok: false,
        quotes: [],
        latencyMs: Date.now() - started,
        failure: {
          sourceId: this.id,
          code: "ERROR",
          message: e instanceof Error ? e.message : "Curb failed",
          retryable: true,
        },
      };
    }
  }
}
