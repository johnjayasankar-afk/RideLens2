import { getEnv } from "@/lib/config";
import { resolveBookingHandoff } from "@/lib/booking/booking-link-resolver";
import { computeFreshness } from "@/lib/domain/freshness";
import { dollarsToMinor, rankingMidpointMinor } from "@/lib/domain/money";
import { confidenceForQuoteType } from "@/lib/domain/ranking";
import type {
  NormalizedQuote,
  QuoteRequest,
  SourceCapabilities,
  SourceHealth,
  SourceQuoteResult,
} from "@/lib/domain/types";
import { fetchDrivingRoute } from "@/lib/routing/osrm";
import type { QuoteSource } from "@/lib/sources/types";
import { computeProductFare, type FareProduct } from "@/lib/sources/ratecard/fare-engine";
import { estimatePickupWait, type WaitCategory } from "@/lib/sources/ratecard/wait-eta";
import { fetchWeatherSignal } from "@/lib/sources/ratecard/weather-signal";

/**
 * Keyless live quote path:
 * 1) Live route distance/duration from public OSRM
 * 2) Traffic-adjusted minutes + published rate cards + NY fee stack
 * 3) Corridor anchors (e.g. Westchester↔Manhattan) + ±2–3.5% band
 */
export class PublicRateCardQuoteSource implements QuoteSource {
  id = "public_rate_card";

  capabilities(): SourceCapabilities {
    return {
      supportsPrice: true,
      supportsUpfront: false,
      supportsETA: true,
      supportsBooking: true,
      supportsAccountLink: false,
      supportsCurrentLocation: true,
      supportsScheduledRide: false,
      markets: ["US"],
      ttlSeconds: 15,
      rateLimitPerMinute: 120,
      comparisonPermitted: true,
    };
  }

  async healthCheck(): Promise<SourceHealth> {
    try {
      const base = getEnv().OSRM_BASE_URL.replace(/\/$/, "");
      const res = await fetch(
        `${base}/route/v1/driving/-73.9857,40.7484;-73.9857,40.7589?overview=false`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) {
        return {
          sourceId: this.id,
          status: "degraded",
          p50LatencyMs: null,
          lastSuccessAt: null,
          lastError: `OSRM HTTP ${res.status}`,
          providersSurfaced: ["uber", "lyft", "curb", "empower"],
        };
      }
      return {
        sourceId: this.id,
        status: "healthy",
        p50LatencyMs: null,
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        providersSurfaced: ["uber", "lyft", "curb", "empower"],
      };
    } catch (e) {
      return {
        sourceId: this.id,
        status: "down",
        p50LatencyMs: null,
        lastSuccessAt: null,
        lastError: e instanceof Error ? e.message : "OSRM unreachable",
        providersSurfaced: [],
      };
    }
  }

  private buildFromFare(input: {
    provider: NormalizedQuote["provider"];
    productId: string;
    productName: string;
    category: NormalizedQuote["normalizedCategory"];
    product: FareProduct;
    miles: number;
    osrmMinutes: number;
    routeCoordinates?: [number, number][];
    request: QuoteRequest;
    distanceMeters: number;
    routingVia: string;
    note?: string;
    priceType?: NormalizedQuote["priceType"];
    weatherSurgeLift?: number;
    weatherLabel?: string;
  }): NormalizedQuote {
    const now = new Date();
    const providerKey =
      input.provider === "curb"
        ? "curb"
        : input.provider === "empower"
          ? "empower"
          : input.provider === "lyft"
            ? "lyft"
            : "uber";

    const fare = computeProductFare({
      product: input.product,
      provider: providerKey,
      pickup: input.request.pickup,
      destination: input.request.destination,
      miles: input.miles,
      osrmMinutes: input.osrmMinutes,
      routeCoordinates: input.routeCoordinates,
      now,
      weatherSurgeLift: input.weatherSurgeLift,
    });

    const minMinor = dollarsToMinor(fare.low);
    const maxMinor = dollarsToMinor(Math.max(fare.low, fare.high));
    const receivedAt = now.toISOString();
    const priceType = input.priceType ?? (minMinor === maxMinor ? "ESTIMATE" : "ESTIMATE_RANGE");

    const wait = estimatePickupWait({
      provider: providerKey,
      category: input.category as WaitCategory,
      pickup: input.request.pickup,
      miles: input.miles,
      osrmMinutes: input.osrmMinutes,
      now,
      marketplaceWaitBoost: fare.waitBoost,
    });

    // Keep quote “live” for ~1 marketplace tick
    const ttlMs = Math.max(45_000, fare.secondsToNextTick * 1000);

    return {
      id: `${input.provider}:${input.productId}`,
      provider: input.provider,
      providerProductId: input.productId,
      providerProductName: input.productName,
      normalizedCategory: input.category,
      priceType,
      priceMinMinor: minMinor,
      priceMaxMinor: maxMinor,
      displayPriceMinor: rankingMidpointMinor(minMinor, maxMinor),
      rankingPriceMinor: rankingMidpointMinor(minMinor, maxMinor),
      currency: "USD",
      pickupEtaSeconds: wait.seconds,
      tripDurationSeconds: Math.round(fare.trafficMinutes * 60),
      distanceMeters: Math.round(input.distanceMeters),
      availability: "AVAILABLE",
      source: this.id,
      sourceMethod: "public_rate_card",
      accountContext: input.request.accountContext,
      receivedAt,
      providerTimestamp: null,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      freshness: computeFreshness(receivedAt, null, now),
      bookingHandoff: resolveBookingHandoff(input.provider, {
        pickup: input.request.pickup,
        destination: input.request.destination,
        productId: input.productId,
        productName: input.productName,
      }),
      confidenceClass: confidenceForQuoteType(priceType, minMinor, maxMinor),
      metadata: {
        methodology:
          "Live OSRM + RideWise/TLC rate cards + NY fee stack + corridor anchors + simulated marketplace (TOD, hotspots, weather via Open-Meteo, provider personality, ~55s ticks). Empower calibrated ~30% under Uber/Lyft (Obi Q1 2026). Not a live partner API quote — confirm in-app.",
        city: fare.marketName,
        demand: fare.demandLabel,
        demandCenter: fare.demandCenter,
        band: fare.band,
        centerFare: fare.center,
        rateCardDollars: fare.rateCardDollars,
        feesDollars: fare.feesDollars,
        feeBreakdown: fare.feeBreakdown,
        anchorId: fare.anchorId,
        anchorWeight: fare.anchorWeight,
        trafficMinutes: fare.trafficMinutes,
        marketplaceTick: fare.marketplaceTick,
        secondsToNextTick: fare.secondsToNextTick,
        marketplaceFactors: fare.marketplaceFactors,
        weather: input.weatherLabel,
        weatherSurgeLift: input.weatherSurgeLift,
        pickupAddress: input.request.pickup.formattedAddress,
        destinationAddress: input.request.destination.formattedAddress,
        note: input.note,
        routingVia: input.routingVia,
        waitLowSeconds: wait.lowSeconds,
        waitHighSeconds: wait.highSeconds,
        waitDensity: wait.density,
        waitConfidence: wait.confidence,
        waitLabel: wait.label,
        doorToDoorSeconds: wait.seconds + Math.round(fare.trafficMinutes * 60),
      },
    };
  }

  async getQuotes(request: QuoteRequest): Promise<SourceQuoteResult> {
    const started = Date.now();
    try {
      const [route, weather] = await Promise.all([
        fetchDrivingRoute(request.pickup, request.destination, request.signal),
        fetchWeatherSignal(request.pickup.lat, request.pickup.lng, request.signal),
      ]);
      const miles = route.miles;
      const osrmMinutes = route.minutes;

      const common = {
        miles,
        osrmMinutes,
        routeCoordinates: route.geometry.coordinates,
        request,
        distanceMeters: route.meters,
        routingVia: route.via,
        weatherSurgeLift: weather.surgeLift,
        weatherLabel: `${weather.label}:${weather.precipMm}mm`,
      };

      const quotes: NormalizedQuote[] = [
        this.buildFromFare({
          ...common,
          provider: "uber",
          productId: "uberx",
          productName: "UberX",
          category: "STANDARD",
          product: "uberx",
        }),
        this.buildFromFare({
          ...common,
          provider: "uber",
          productId: "uber_comfort",
          productName: "Uber Comfort",
          category: "PREMIUM",
          product: "comfort",
        }),
        this.buildFromFare({
          ...common,
          provider: "uber",
          productId: "uberxl",
          productName: "UberXL",
          category: "XL",
          product: "uberxl",
        }),
        this.buildFromFare({
          ...common,
          provider: "lyft",
          productId: "lyft",
          productName: "Lyft",
          category: "STANDARD",
          product: "lyft",
        }),
        this.buildFromFare({
          ...common,
          provider: "lyft",
          productId: "lyft_xl",
          productName: "Lyft XL",
          category: "XL",
          product: "lyft_xl",
        }),
        this.buildFromFare({
          ...common,
          provider: "curb",
          productId: "curb_taxi",
          productName: "Curb Taxi",
          category: "TAXI",
          product: "taxi",
          note: "TLC meter + peak/night surcharges; Manhattan↔JFK flat when applicable.",
        }),
        this.buildFromFare({
          ...common,
          provider: "empower",
          productId: "empower_standard",
          productName: "Empower Standard",
          category: "STANDARD",
          product: "empower",
          priceType: "ESTIMATE",
          note: "Calibrated ~30% under UberX-class (Obi Q1 2026 NYC receipts). Confirm in app.",
        }),
      ];

      return {
        sourceId: this.id,
        ok: true,
        quotes,
        latencyMs: Date.now() - started,
        raw: {
          miles,
          osrmMinutes,
          routingVia: route.via,
          geometry: route.geometry,
          bbox: route.bbox,
          weather,
          sample: quotes[0]?.metadata,
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
          message: e instanceof Error ? e.message : "Rate card source failed",
          retryable: true,
        },
      };
    }
  }
}
