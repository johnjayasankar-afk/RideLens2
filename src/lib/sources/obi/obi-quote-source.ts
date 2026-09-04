import { randomUUID } from "crypto";
import { computeFreshness } from "@/lib/domain/freshness";
import { dollarsToMinor, rankingMidpointMinor } from "@/lib/domain/money";
import { confidenceForQuoteType } from "@/lib/domain/ranking";
import { mapProductToCategory } from "@/lib/domain/taxonomy";
import type {
  CanonicalLocation,
  NormalizedQuote,
  ProviderId,
  QuoteRequest,
  RideCategory,
  SourceCapabilities,
  SourceHealth,
  SourceQuoteResult,
} from "@/lib/domain/types";
import { resolveBookingHandoff } from "@/lib/booking/booking-link-resolver";
import { getEnv } from "@/lib/config";
import type { QuoteSource } from "@/lib/sources/types";
import { ConfigurationError } from "@/lib/sources/types";
import { z } from "zod";

const marketPriceSchema = z.object({
  p5: z.number().optional(),
  p25: z.number().optional(),
  p50: z.number(),
  p75: z.number().optional(),
  p95: z.number().optional(),
});

const obiQuoteResponseSchema = z.object({
  requestId: z.string().optional(),
  mode: z.string().optional(),
  currency: z.string().default("USD"),
  distanceKm: z.number().optional(),
  durationMinutes: z.number().optional(),
  marketPrices: z.record(z.string(), marketPriceSchema).default({}),
  recommendations: z.record(z.string(), z.unknown()).optional(),
});

type TokenCache = { token: string; expiresAt: number };

let tokenCache: TokenCache | null = null;

function parseProviderKey(key: string): {
  provider: ProviderId;
  serviceLevel: string;
} {
  const [rawProvider, ...rest] = key.split("/");
  const serviceLevel = rest.join("/") || "Standard";
  const p = (rawProvider || "other").toLowerCase();
  const provider: ProviderId =
    p === "uber" ||
    p === "lyft" ||
    p === "empower" ||
    p === "curb" ||
    p === "waymo"
      ? p
      : "other";
  return { provider, serviceLevel };
}

function serviceToCategory(serviceLevel: string, provider: ProviderId): RideCategory {
  return mapProductToCategory(provider, serviceLevel);
}

export class ObiQuoteSource implements QuoteSource {
  id = "obi";

  capabilities(): SourceCapabilities {
    return {
      supportsPrice: true,
      supportsUpfront: false,
      supportsETA: false,
      supportsBooking: true,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: true,
      markets: ["US", "global"],
      ttlSeconds: 20,
      rateLimitPerMinute: 60,
      comparisonPermitted: true,
    };
  }

  private ensureConfigured(): { key: string; secret: string; base: string } {
    const env = getEnv();
    if (!env.OBI_API_KEY || !env.OBI_API_SECRET) {
      throw new ConfigurationError(
        "Obi FARE.AI credentials missing. Set OBI_API_KEY and OBI_API_SECRET after partner approval.",
      );
    }
    return {
      key: env.OBI_API_KEY,
      secret: env.OBI_API_SECRET,
      base: env.OBI_API_BASE_URL.replace(/\/$/, ""),
    };
  }

  private async getToken(base: string, key: string, secret: string): Promise<string> {
    if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
      return tokenCache.token;
    }
    const res = await fetch(`${base}/v1/auth/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "X-API-SECRET": secret,
      },
    });
    if (!res.ok) {
      throw new Error(`Obi auth failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { token: string; ttlSeconds?: number };
    tokenCache = {
      token: body.token,
      expiresAt: Date.now() + (body.ttlSeconds ?? 86400) * 1000,
    };
    return body.token;
  }

  async healthCheck(): Promise<SourceHealth> {
    try {
      this.ensureConfigured();
      return {
        sourceId: this.id,
        status: "healthy",
        p50LatencyMs: null,
        lastSuccessAt: null,
        lastError: null,
        providersSurfaced: ["uber", "lyft", "empower", "curb", "waymo"],
      };
    } catch (e) {
      return {
        sourceId: this.id,
        status: "misconfigured",
        p50LatencyMs: null,
        lastSuccessAt: null,
        lastError: e instanceof Error ? e.message : "misconfigured",
        providersSurfaced: [],
      };
    }
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const started = Date.now();
    try {
      const { key, secret, base } = this.ensureConfigured();
      const token = await this.getToken(base, key, secret);
      const res = await fetch(`${base}/v1/quote`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pickup: {
            latitude: request.pickup.lat,
            longitude: request.pickup.lng,
          },
          destination: {
            latitude: request.destination.lat,
            longitude: request.destination.lng,
          },
        }),
        signal: request.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          sourceId: this.id,
          ok: false,
          quotes: [],
          latencyMs: Date.now() - started,
          failure: {
            sourceId: this.id,
            code: `HTTP_${res.status}`,
            message: text || `Obi quote failed: ${res.status}`,
            retryable: res.status >= 500,
          },
        };
      }

      const json = await res.json();
      const parsed = obiQuoteResponseSchema.safeParse(json);
      if (!parsed.success) {
        return {
          sourceId: this.id,
          ok: false,
          quotes: [],
          latencyMs: Date.now() - started,
          failure: {
            sourceId: this.id,
            code: "SCHEMA_INVALID",
            message: "Obi response failed schema validation",
            retryable: false,
          },
          raw: json,
        };
      }

      const now = new Date();
      const receivedAt = now.toISOString();
      const quotes: NormalizedQuote[] = [];

      for (const [keyName, price] of Object.entries(parsed.data.marketPrices)) {
        const { provider, serviceLevel } = parseProviderKey(keyName);
        const min = dollarsToMinor(price.p25 ?? price.p5 ?? price.p50);
        const max = dollarsToMinor(price.p75 ?? price.p95 ?? price.p50);
        const mid = dollarsToMinor(price.p50);
        const category = serviceToCategory(serviceLevel, provider);
        const priceType = "ESTIMATE_RANGE" as const;
        const confidenceClass = confidenceForQuoteType(priceType, min, max);

        const quote: NormalizedQuote = {
          id: randomUUID(),
          provider,
          providerProductId: keyName,
          providerProductName: `${providerLabel(provider)} ${serviceLevel}`,
          normalizedCategory: category,
          priceType,
          priceMinMinor: min,
          priceMaxMinor: max,
          displayPriceMinor: mid,
          rankingPriceMinor: rankingMidpointMinor(min, max),
          currency: parsed.data.currency || "USD",
          pickupEtaSeconds: null,
          tripDurationSeconds: parsed.data.durationMinutes
            ? Math.round(parsed.data.durationMinutes * 60)
            : null,
          distanceMeters: parsed.data.distanceKm
            ? Math.round(parsed.data.distanceKm * 1000)
            : null,
          availability: "AVAILABLE",
          source: this.id,
          sourceMethod: "licensed_aggregation",
          accountContext: request.accountContext,
          receivedAt,
          providerTimestamp: null,
          expiresAt: new Date(now.getTime() + 90_000).toISOString(),
          freshness: computeFreshness(receivedAt, null, now),
          bookingHandoff: resolveBookingHandoff(provider, {
            pickup: request.pickup,
            destination: request.destination,
            productId: undefined,
            productName: serviceLevel,
          }),
          confidenceClass,
          metadata: {
            marketKey: keyName,
            percentiles: price,
            obiMode: parsed.data.mode,
            requestId: parsed.data.requestId,
            semantics:
              "Obi FARE.AI market percentile distribution — ESTIMATE_RANGE, not consumer account upfront.",
          },
        };
        quotes.push(quote);
      }

      return {
        sourceId: this.id,
        ok: true,
        quotes,
        latencyMs: Date.now() - started,
        raw: parsed.data,
      };
    } catch (e) {
      return {
        sourceId: this.id,
        ok: false,
        quotes: [],
        latencyMs: Date.now() - started,
        failure: {
          sourceId: this.id,
          code: e instanceof ConfigurationError ? "NOT_CONFIGURED" : "ERROR",
          message: e instanceof Error ? e.message : "Obi request failed",
          retryable: !(e instanceof ConfigurationError),
        },
      };
    }
  }
}

function providerLabel(p: ProviderId): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function buildObiLocationPair(
  pickup: CanonicalLocation,
  destination: CanonicalLocation,
) {
  return { pickup, destination };
}
