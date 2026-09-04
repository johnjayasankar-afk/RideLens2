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
import { z } from "zod";

const costEstimateSchema = z.object({
  ride_type: z.string(),
  display_name: z.string().optional(),
  estimated_cost_cents_min: z.number().optional(),
  estimated_cost_cents_max: z.number().optional(),
  currency: z.string().optional(),
  primetime_percentage: z.string().optional(),
  can_request_ride: z.boolean().optional(),
});

const costResponseSchema = z.object({
  cost_estimates: z.array(costEstimateSchema).default([]),
});

const etaSchema = z.object({
  ride_type: z.string(),
  eta_seconds: z.number().optional(),
  display_name: z.string().optional(),
  is_valid_estimate: z.boolean().optional(),
});

const etaResponseSchema = z.object({
  eta_estimates: z.array(etaSchema).default([]),
});

/**
 * Lyft public cost/ETA APIs historically existed at api.lyft.com.
 * Enabled only when LYFT_COMPARISON_AUTHORIZED=true and credentials present.
 * Commercial comparison rights must be confirmed before production use.
 */
export class LyftAuthorizedQuoteSource implements QuoteSource {
  id = "lyft_authorized";
  private tokenCache: { token: string; expiresAt: number } | null = null;

  capabilities(): SourceCapabilities {
    const env = getEnv();
    const ok = Boolean(
      env.LYFT_COMPARISON_AUTHORIZED &&
        env.LYFT_CLIENT_ID &&
        env.LYFT_CLIENT_SECRET,
    );
    return {
      supportsPrice: ok,
      supportsUpfront: false,
      supportsETA: ok,
      supportsBooking: true,
      supportsAccountLink: true,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ["US"],
      ttlSeconds: 20,
      rateLimitPerMinute: 60,
      comparisonPermitted: Boolean(env.LYFT_COMPARISON_AUTHORIZED),
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const env = getEnv();
    if (!env.LYFT_COMPARISON_AUTHORIZED) {
      return {
        sourceId: this.id,
        status: "disabled",
        p50LatencyMs: null,
        lastSuccessAt: null,
        lastError: "LYFT_COMPARISON_AUTHORIZED not set — partner approval required",
        providersSurfaced: [],
      };
    }
    if (!env.LYFT_CLIENT_ID || !env.LYFT_CLIENT_SECRET) {
      return {
        sourceId: this.id,
        status: "misconfigured",
        p50LatencyMs: null,
        lastSuccessAt: null,
        lastError: "LYFT_CLIENT_ID/SECRET missing",
        providersSurfaced: [],
      };
    }
    return {
      sourceId: this.id,
      status: "healthy",
      p50LatencyMs: null,
      lastSuccessAt: null,
      lastError: null,
      providersSurfaced: ["lyft"],
    };
  }

  private async getClientToken(): Promise<string> {
    const env = getEnv();
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }
    const basic = Buffer.from(
      `${env.LYFT_CLIENT_ID}:${env.LYFT_CLIENT_SECRET}`,
    ).toString("base64");
    const res = await fetch("https://api.lyft.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grant_type: "client_credentials", scope: "public" }),
    });
    if (!res.ok) throw new Error(`Lyft auth failed: ${res.status}`);
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokenCache = {
      token: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return body.access_token;
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const started = Date.now();
    const env = getEnv();
    if (
      !env.LYFT_COMPARISON_AUTHORIZED ||
      !env.LYFT_CLIENT_ID ||
      !env.LYFT_CLIENT_SECRET
    ) {
      return {
        sourceId: this.id,
        ok: false,
        quotes: [],
        latencyMs: Date.now() - started,
        failure: {
          sourceId: this.id,
          code: "NOT_AUTHORIZED",
          message:
            "Lyft comparison disabled until LYFT_COMPARISON_AUTHORIZED=true and credentials are set.",
          retryable: false,
        },
      };
    }

    try {
      const token = await this.getClientToken();
      const costUrl = new URL("https://api.lyft.com/v1/cost");
      costUrl.searchParams.set("start_lat", String(request.pickup.lat));
      costUrl.searchParams.set("start_lng", String(request.pickup.lng));
      costUrl.searchParams.set("end_lat", String(request.destination.lat));
      costUrl.searchParams.set("end_lng", String(request.destination.lng));

      const etaUrl = new URL("https://api.lyft.com/v1/eta");
      etaUrl.searchParams.set("lat", String(request.pickup.lat));
      etaUrl.searchParams.set("lng", String(request.pickup.lng));

      const headers = { Authorization: `Bearer ${token}` };
      const [costRes, etaRes] = await Promise.all([
        fetch(costUrl, { headers, signal: request.signal }),
        fetch(etaUrl, { headers, signal: request.signal }),
      ]);

      if (!costRes.ok) {
        return {
          sourceId: this.id,
          ok: false,
          quotes: [],
          latencyMs: Date.now() - started,
          failure: {
            sourceId: this.id,
            code: `HTTP_${costRes.status}`,
            message: `Lyft cost failed: ${costRes.status}`,
            retryable: costRes.status >= 500,
          },
        };
      }

      const costJson = await costRes.json();
      const costParsed = costResponseSchema.safeParse(costJson);
      if (!costParsed.success) {
        return {
          sourceId: this.id,
          ok: false,
          quotes: [],
          latencyMs: Date.now() - started,
          failure: {
            sourceId: this.id,
            code: "SCHEMA_INVALID",
            message: "Lyft cost response invalid",
            retryable: false,
          },
          raw: costJson,
        };
      }

      const etaMap = new Map<string, number>();
      if (etaRes.ok) {
        const etaJson = await etaRes.json();
        const etaParsed = etaResponseSchema.safeParse(etaJson);
        if (etaParsed.success) {
          for (const e of etaParsed.data.eta_estimates) {
            if (e.eta_seconds != null) etaMap.set(e.ride_type, e.eta_seconds);
          }
        }
      }

      const now = new Date();
      const receivedAt = now.toISOString();
      const quotes: NormalizedQuote[] = costParsed.data.cost_estimates.map(
        (c) => {
          const min = c.estimated_cost_cents_min ?? 0;
          const max = c.estimated_cost_cents_max ?? min;
          const priceType =
            min === max ? ("ESTIMATE" as const) : ("ESTIMATE_RANGE" as const);
          const name = c.display_name || c.ride_type;
          return {
            id: randomUUID(),
            provider: "lyft" as const,
            providerProductId: c.ride_type,
            providerProductName: name,
            normalizedCategory: mapProductToCategory("lyft", name, c.ride_type),
            priceType,
            priceMinMinor: min,
            priceMaxMinor: max,
            displayPriceMinor: Math.round((min + max) / 2),
            rankingPriceMinor: Math.round((min + max) / 2),
            currency: c.currency || "USD",
            pickupEtaSeconds: etaMap.get(c.ride_type) ?? null,
            tripDurationSeconds: null,
            distanceMeters: null,
            availability:
              c.can_request_ride === false ? "UNAVAILABLE" : "AVAILABLE",
            source: this.id,
            sourceMethod: "authorized_direct" as const,
            accountContext: request.accountContext,
            receivedAt,
            providerTimestamp: null,
            expiresAt: new Date(now.getTime() + 90_000).toISOString(),
            freshness: computeFreshness(receivedAt, null, now),
            bookingHandoff: resolveBookingHandoff("lyft", {
              pickup: request.pickup,
              destination: request.destination,
              productId: c.ride_type,
              productName: name,
            }),
            confidenceClass: confidenceForQuoteType(priceType, min, max),
            metadata: { primetime: c.primetime_percentage },
          };
        },
      );

      return {
        sourceId: this.id,
        ok: true,
        quotes,
        latencyMs: Date.now() - started,
        raw: costJson,
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
          message: e instanceof Error ? e.message : "Lyft request failed",
          retryable: true,
        },
      };
    }
  }
}
