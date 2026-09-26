/**
 * When to leave, and when we cannot say.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Everything else in this product answers "what does it cost now". This    │
 * │ answers "would waiting help", which is the question a model is actually  │
 * │ better placed to answer than a partner API — because no API can quote a  │
 * │ ride that has not happened yet. It is the one place a modeled estimate   │
 * │ beats a live feed rather than apologising to it.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── The trap this module exists to avoid ───────────────────────────────────
 *
 * marketplace-dynamics.ts moves on ~55-second ticks, and part of that
 * movement is `microVolatility`: a hash of the tick index, amplitude up to
 * 5.5%, with no predictive content whatever. It is there so the marketplace
 * feels alive, and it is honest about being noise.
 *
 * Project one tick forward, find the dip, and you can write "leaving in 18
 * minutes is $6 cheaper" — a recommendation generated from a hash function.
 * It would look exactly like insight. It would be the single most dishonest
 * thing this product could do, because unlike a wrong price it cannot be
 * checked by the rider against anything.
 *
 * So two rules, and the whole module is built around them:
 *
 *   1. **Average across ticks.** Several adjacent ticks per point, so the
 *      jitter cancels and what remains is the time-of-day demand curve, the
 *      zone heat and the weather — the parts that mean something.
 *
 *   2. **Refuse unless the bands clear.** How far the samples spread at a
 *      point is a *measured* estimate of how much that number wanders, and it
 *      goes into the band. A later window is only ever called cheaper when its
 *      band sits entirely below the band for leaving now. This is
 *      `comparePrices` pointed at the future, and it says "no clear window"
 *      often, which is the correct answer most of the time.
 *
 * Nothing here mutates the marketplace model, and nothing re-implements it:
 * every point is the real fare engine called with a future clock.
 */

import type { ConfidenceClass } from "./types";
import { MODEL_PARAMS } from "@/lib/sources/ratecard/model-params";
import { computeProductFare, type ComputedFare } from "@/lib/sources/ratecard/fare-engine";
import type {
  MarketplaceProduct,
  MarketplaceProvider,
} from "@/lib/sources/ratecard/marketplace-dynamics";
import { estimatePickupWait, type WaitCategory } from "@/lib/sources/ratecard/wait-eta";

export interface ForecastInput {
  provider: MarketplaceProvider;
  product: MarketplaceProduct;
  waitCategory: WaitCategory;
  pickup: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  miles: number;
  osrmMinutes: number;
  routeCoordinates?: [number, number][];
  weatherSurgeLift?: number;
  now?: Date;
}

export interface ForecastPoint {
  minutesFromNow: number;
  /** ISO timestamp of the modeled departure. */
  at: string;
  /**
   * The centre of the band, in minor units.
   *
   * Exported for comparison arithmetic and never for display. A forecast
   * shown as a single number is a claim to know the future exactly; every
   * surface renders lowMinor–highMinor.
   */
  centerMinor: number;
  lowMinor: number;
  highMinor: number;
  waitSeconds: number;
  waitLowSeconds: number;
  waitHighSeconds: number;
  /**
   * Half-width to use when comparing this point with another from the same
   * model — always narrower than (highMinor - lowMinor) / 2.
   *
   * The displayed band answers "what might this actually cost", and most of
   * that uncertainty belongs to the model rather than to the hour. Comparing
   * two points from one model cancels it: if the engine reads high, it reads
   * high at both ends. What survives is the tick-to-tick wander, which is
   * measured here, and error in the shape of the demand curve between the
   * two times, which is not.
   *
   * Displaying this narrower figure would be a lie about precision. Using
   * the wide one to compare was a different error, and made the advice fire
   * on none of 48 tested departure times.
   */
  comparisonHalfMinor: number;
  /** Never HIGH. A projection is not a quote. */
  confidence: ConfidenceClass;
}

export interface ProviderForecast {
  provider: MarketplaceProvider;
  product: MarketplaceProduct;
  points: ForecastPoint[];
  /** The point this provider is cheapest at, band-clearance ignored. */
  cheapest: ForecastPoint;
  modelVersion: string;
}

export type AdviceKind = "leave_now" | "wait" | "no_clear_window";

export interface DepartureAdvice {
  kind: AdviceKind;
  /** Minutes to wait, when kind is "wait". */
  minutesFromNow: number | null;
  /** The part of the saving that clears both bands. Never the raw difference. */
  savingMinor: number | null;
  /** One sentence, already hedged, safe to render as-is. */
  sentence: string;
}

export interface DepartureWindow {
  generatedAt: string;
  horizonMinutes: number;
  stepMinutes: number;
  forecasts: ProviderForecast[];
  advice: DepartureAdvice;
  modelVersion: string;
}

/**
 * Extra half-width at a given horizon, as a fraction of the centre.
 *
 * Linear in horizon: zero now, `horizonWideningPerHour` at sixty minutes.
 * The real shape is surely not linear, but nothing here has been measured
 * against an outcome yet, and a straight line is the honest thing to draw
 * through no data. `docs/COLLECTION_PROTOCOL.md` says how to replace it.
 */
export function horizonWidening(minutesFromNow: number): number {
  const { horizonWideningPerHour } = MODEL_PARAMS.forecast;
  return (Math.max(0, minutesFromNow) / 60) * horizonWideningPerHour;
}

/**
 * The part of that widening which does *not* cancel between two points of
 * the same model. See ForecastPoint.comparisonHalfMinor.
 */
export function differentialWidening(minutesFromNow: number): number {
  const { differentialWideningPerHour } = MODEL_PARAMS.forecast;
  return (Math.max(0, minutesFromNow) / 60) * differentialWideningPerHour;
}

/**
 * Confidence for a projected point.
 *
 * Starts one class below whatever a live quote would get, because it is a
 * projection, and falls away from there. There is no path to HIGH.
 */
export function forecastConfidence(minutesFromNow: number): ConfidenceClass {
  if (minutesFromNow <= 0) return "MEDIUM";
  if (minutesFromNow <= 20) return "MEDIUM";
  if (minutesFromNow <= 45) return "LOW";
  return "UNCERTAIN";
}

const toMinor = (dollars: number) => Math.round(dollars * 100);

/**
 * One point: several ticks, averaged, with their spread folded into the band.
 */
function pointAt(input: ForecastInput, base: Date, minutesFromNow: number): ForecastPoint {
  const { samplesPerPoint, sampleSpacingSeconds } = MODEL_PARAMS.forecast;
  const at = new Date(base.getTime() + minutesFromNow * 60_000);

  const centers: number[] = [];
  const halfWidths: number[] = [];
  let lastFare: ComputedFare | null = null;

  /* Samples straddle the point so the average is centred on it. */
  const offset = ((samplesPerPoint - 1) / 2) * sampleSpacingSeconds;
  for (let i = 0; i < samplesPerPoint; i += 1) {
    const when = new Date(at.getTime() + (i * sampleSpacingSeconds - offset) * 1000);
    const fare = computeProductFare({
      product: input.product,
      provider: input.provider,
      pickup: input.pickup,
      destination: input.destination,
      miles: input.miles,
      osrmMinutes: input.osrmMinutes,
      routeCoordinates: input.routeCoordinates,
      now: when,
      weatherSurgeLift: input.weatherSurgeLift,
    });
    centers.push(fare.center);
    halfWidths.push(Math.max(0, (fare.high - fare.low) / 2));
    lastFare = fare;
  }

  const center = centers.reduce((a, b) => a + b, 0) / centers.length;
  const baseHalf = halfWidths.reduce((a, b) => a + b, 0) / halfWidths.length;
  /*
   * How far the samples wandered is not noise to be discarded — it is the
   * best evidence available about how much this number moves tick to tick,
   * so it widens the band rather than being averaged away.
   */
  const spreadHalf = (Math.max(...centers) - Math.min(...centers)) / 2;
  const horizonHalf = center * horizonWidening(minutesFromNow);
  const half = Math.max(baseHalf, spreadHalf) + horizonHalf;
  /*
   * For comparison, two corrections to the displayed band.
   *
   * The level error is dropped, because it is shared by both points being
   * compared and cancels in the difference.
   *
   * And the tick wander enters as the uncertainty of the *average*, not the
   * spread of the samples — which is that spread over sqrt(n). A rider
   * experiences one tick, so the full spread is the honest thing to display;
   * but what is being compared here is two averages, and treating their
   * spread as their error overstates it by about 2.2x at five samples. That
   * mistake is why this fired on one departure time out of 48.
   */
  const meanSpreadHalf = spreadHalf / Math.sqrt(samplesPerPoint);
  const comparisonHalf = meanSpreadHalf + center * differentialWidening(minutesFromNow);

  const wait = estimatePickupWait({
    provider: input.provider === "curb" ? "curb" : input.provider,
    category: input.waitCategory,
    pickup: input.pickup,
    miles: input.miles,
    osrmMinutes: input.osrmMinutes,
    now: at,
    marketplaceWaitBoost: lastFare?.waitBoost,
  });

  return {
    minutesFromNow,
    at: at.toISOString(),
    centerMinor: toMinor(center),
    lowMinor: toMinor(Math.max(0, center - half)),
    highMinor: toMinor(center + half),
    waitSeconds: wait.seconds,
    waitLowSeconds: wait.lowSeconds,
    waitHighSeconds: wait.highSeconds,
    comparisonHalfMinor: toMinor(comparisonHalf),
    confidence: forecastConfidence(minutesFromNow),
  };
}

export function forecastProvider(input: ForecastInput): ProviderForecast {
  const base = input.now ?? new Date();
  const { horizonMinutes, stepMinutes } = MODEL_PARAMS.forecast;

  const points: ForecastPoint[] = [];
  for (let m = 0; m <= horizonMinutes; m += stepMinutes) {
    points.push(pointAt(input, base, m));
  }

  const cheapest = points.reduce((a, b) => (b.centerMinor < a.centerMinor ? b : a));

  return {
    provider: input.provider,
    product: input.product,
    points,
    cheapest,
    modelVersion: MODEL_PARAMS.version,
  };
}

/**
 * Whether a later window is cheap enough to say so out loud.
 *
 * The test is clearance, not a difference of centres: two windows whose
 * uncertainties touch are indistinguishable, and saying otherwise would be
 * the forward-looking version of asserting a winner between overlapping
 * quotes — which `comparePrices` already refuses to do.
 *
 * The clearance is measured against `comparisonHalfMinor`, not the displayed
 * band, because comparing two points of one model cancels the model's own
 * level error. Using the displayed band here was arithmetically fine and
 * statistically wrong: it fired on none of 48 tested departure times.
 */
export function adviseDeparture(forecasts: readonly ProviderForecast[]): DepartureAdvice {
  const { minMeaningfulSavingMinor } = MODEL_PARAMS.forecast;

  const nowPoints = forecasts
    .map((f) => f.points.find((p) => p.minutesFromNow === 0))
    .filter((p): p is ForecastPoint => Boolean(p));

  if (nowPoints.length === 0) {
    return {
      kind: "no_clear_window",
      minutesFromNow: null,
      savingMinor: null,
      sentence: "Not enough modeled to say whether waiting would help.",
    };
  }

  /* The best you can do by leaving immediately. */
  const bestNow = nowPoints.reduce((a, b) => (b.centerMinor < a.centerMinor ? b : a));

  let best: { point: ForecastPoint; clearance: number } | null = null;
  for (const f of forecasts) {
    for (const p of f.points) {
      if (p.minutesFromNow <= 0) continue;
      const nowFloor = bestNow.centerMinor - bestNow.comparisonHalfMinor;
      const laterCeiling = p.centerMinor + p.comparisonHalfMinor;
      const clearance = nowFloor - laterCeiling;
      if (clearance < minMeaningfulSavingMinor) continue;
      if (!best || clearance > best.clearance) best = { point: p, clearance };
    }
  }

  if (!best) {
    return {
      kind: "leave_now",
      minutesFromNow: 0,
      savingMinor: null,
      sentence:
        "Waiting is not modeled to help in the next hour — nothing later is clearly cheaper than leaving now.",
    };
  }

  const mins = best.point.minutesFromNow;
  const low = (best.clearance / 100).toFixed(2);
  return {
    kind: "wait",
    minutesFromNow: mins,
    savingMinor: best.clearance,
    sentence: `Leaving in about ${mins} minutes is modeled at least $${low} cheaper — a projection, not a quote.`,
  };
}

export function buildDepartureWindow(inputs: readonly ForecastInput[]): DepartureWindow {
  const base = inputs[0]?.now ?? new Date();
  const forecasts = inputs.map((i) => forecastProvider({ ...i, now: base }));
  return {
    generatedAt: base.toISOString(),
    horizonMinutes: MODEL_PARAMS.forecast.horizonMinutes,
    stepMinutes: MODEL_PARAMS.forecast.stepMinutes,
    forecasts,
    advice: adviseDeparture(forecasts),
    modelVersion: MODEL_PARAMS.version,
  };
}
