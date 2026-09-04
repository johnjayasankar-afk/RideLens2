import type {
  QuoteRequest,
  SourceCapabilities,
  SourceHealth,
  SourceQuoteResult,
} from "@/lib/domain/types";
import { getEnv } from "@/lib/config";
import type { QuoteSource } from "@/lib/sources/types";

/**
 * Empower rideshare (rideempower) — no public developer quote API found.
 * Pre-request fares are estimates; driver acceptance may change price.
 * Adapter ready for partner endpoint once EMPOWER_API_KEY + BASE_URL exist.
 */
export class EmpowerAuthorizedQuoteSource implements QuoteSource {
  id = "empower_authorized";

  capabilities(): SourceCapabilities {
    const env = getEnv();
    const ok = Boolean(env.EMPOWER_API_KEY && env.EMPOWER_API_BASE_URL);
    return {
      supportsPrice: ok,
      supportsUpfront: false,
      supportsETA: ok,
      supportsBooking: true,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ["US"],
      ttlSeconds: 20,
      rateLimitPerMinute: 30,
      comparisonPermitted: ok,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    const env = getEnv();
    if (!env.EMPOWER_API_KEY || !env.EMPOWER_API_BASE_URL) {
      return {
        sourceId: this.id,
        status: "misconfigured",
        p50LatencyMs: null,
        lastSuccessAt: null,
        lastError:
          "No public Empower quote API. Set EMPOWER_API_KEY + EMPOWER_API_BASE_URL after partner access, or obtain Empower via Obi.",
        providersSurfaced: [],
      };
    }
    return {
      sourceId: this.id,
      status: "healthy",
      p50LatencyMs: null,
      lastSuccessAt: null,
      lastError: null,
      providersSurfaced: ["empower"],
    };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const started = Date.now();
    const env = getEnv();
    if (!env.EMPOWER_API_KEY || !env.EMPOWER_API_BASE_URL) {
      return {
        sourceId: this.id,
        ok: false,
        quotes: [],
        latencyMs: Date.now() - started,
        failure: {
          sourceId: this.id,
          code: "PARTNER_ACCESS_REQUIRED",
          message:
            "Empower has no public quote API. Partner credentials required. Never treat Empower pre-request fares as locked final prices.",
          retryable: false,
        },
      };
    }

    // Partner-shaped activation path
    try {
      const base = env.EMPOWER_API_BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/v1/quotes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.EMPOWER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pickup: { lat: request.pickup.lat, lng: request.pickup.lng },
          destination: {
            lat: request.destination.lat,
            lng: request.destination.lng,
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
            message: `Empower partner API failed: ${res.status}`,
            retryable: res.status >= 500,
          },
        };
      }

      // Parsing deferred until partner schema is confirmed — return empty success with note
      return {
        sourceId: this.id,
        ok: false,
        quotes: [],
        latencyMs: Date.now() - started,
        failure: {
          sourceId: this.id,
          code: "SCHEMA_PENDING",
          message:
            "Empower partner endpoint reachable shape not yet contract-verified. Adapter ready for schema mapping.",
          retryable: false,
        },
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
          message: e instanceof Error ? e.message : "Empower failed",
          retryable: true,
        },
      };
    }
  }
}
