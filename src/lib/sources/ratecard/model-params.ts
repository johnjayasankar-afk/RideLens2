/**
 * Every number in the model that is a guess, in one place, behind a version.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THESE HAD TO BE GATHERED UP                                          │
 * │                                                                          │
 * │ trafficDurationFactor returns 1.3 in the morning, 1.35 in the evening    │
 * │ and 1.12 at midday. Nobody can say where those came from. They are       │
 * │ scattered through fare-engine.ts and marketplace-dynamics.ts alongside   │
 * │ published rate-card amounts, which *are* sourced — and the two kinds of  │
 * │ number are indistinguishable when read in place.                         │
 * │                                                                          │
 * │ A tariff is a fact. 1.35 is a parameter. Parameters belong together,     │
 * │ versioned, so the eval harness can say which set produced a prediction   │
 * │ and whether changing them made the model better or merely different.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Changing any value here means bumping MODEL_VERSION, re-running
 * `npm run eval`, and refusing the change if coverage-adjusted sharpness
 * regressed. That is the whole point of the version: a quote records which
 * parameter set produced it, so a corpus spanning a change can be split.
 */

/**
 * Bump on any change below. Date-ordered so a corpus sorts chronologically.
 *
 * v1 is the set the model shipped with — recorded, not endorsed. None of it
 * has been fitted to observed fares, because until the eval harness existed
 * there was nothing to fit against.
 */
export const MODEL_VERSION = "2026-09-25.v1";

export interface TrafficParams {
  /** Multipliers on OSRM's free-flow duration, by period. */
  morningPeak: number;
  eveningPeak: number;
  midday: number;
  weekendDay: number;
  overnight: number;
}

export interface BandParams {
  /** Half-width of the base band, as a fraction of the centre. */
  baseRelativeHalfWidth: number;
  /** Extra width when the rate card was borrowed from another market. */
  extrapolationWidening: number;
  /** Extra width when the market's regulatory fees are not modeled. */
  unmodeledFeeWidening: number;
  /** Flat relief added to both edges whenever either applies. */
  widenedEdgeRelief: number;
}

export interface DemandParams {
  /** Peak heights of the gaussian time-of-day bumps. */
  lunchLift: number;
  afternoonLift: number;
  nightLift: number;
  /** Zone-heat contributions for airports, core and nightlife. */
  airportHeat: number;
  coreHeat: number;
  nightlifeHeat: number;
}

export type WaitDensity = "core" | "inner" | "outer" | "suburb" | "airport" | "sparse";

export interface WaitParams {
  /** Base pickup wait in minutes for an UberX-class car, by supply density. */
  baseMinutes: Record<WaitDensity, number>;
  /** Fleet and matching multipliers relative to UberX-class. */
  provider: Record<string, number>;
  /** Vehicle-class multipliers — a WAV waits far longer than a sedan. */
  category: Record<string, number>;
  /** Ceiling by density, so the model never claims an absurd live ETA. */
  capMinutes: { core: number; sparse: number };
  /** Floor, for the same reason in the other direction. */
  floorMinutes: number;
}

export interface WeatherParams {
  /** Surge lift at the top of the modeled precipitation scale. */
  maxLift: number;
}

export interface ModelParams {
  version: string;
  traffic: TrafficParams;
  band: BandParams;
  demand: DemandParams;
  weather: WeatherParams;
  wait: WaitParams;
}

/**
 * The values the model currently runs on.
 *
 * Every one is a prior, not a measurement. They are written here rather than
 * inline so that `npm run eval` can attribute a corpus to them, and so that
 * the next person to change one can see what else moves with it.
 */
export const MODEL_PARAMS: ModelParams = {
  version: MODEL_VERSION,
  traffic: {
    morningPeak: 1.3,
    eveningPeak: 1.35,
    midday: 1.12,
    weekendDay: 1.12,
    overnight: 1,
  },
  band: {
    baseRelativeHalfWidth: 0.035,
    extrapolationWidening: 2.2,
    unmodeledFeeWidening: 1.5,
    widenedEdgeRelief: 0.08,
  },
  demand: {
    lunchLift: 0.06,
    afternoonLift: 0.05,
    nightLift: 0.05,
    airportHeat: 0.08,
    coreHeat: 0.06,
    nightlifeHeat: 0.04,
  },
  weather: {
    maxLift: 0.18,
  },
  /*
   * ── On where these came from ──────────────────────────────────────────
   *
   * wait-eta.ts opened with a list of anchors attributed to named studies —
   * "AMNY / TLC WAV contrast studies", "RideWise 2026". Nothing in this
   * repository evidences any of them, and a citation nobody can follow is
   * worse than no citation: it lends a guess the authority of a measurement.
   *
   * They are recorded here as what they are. Plausible priors, of the right
   * order of magnitude, fitted to nothing. `npm run eval` can now score the
   * wait model, and when it has 20 samples these should move to whatever the
   * data says. Until then the product calls this a modeled wait everywhere
   * it appears, which is the only honest thing available.
   */
  wait: {
    baseMinutes: {
      core: 2.4,
      inner: 3.6,
      outer: 5.8,
      suburb: 8.5,
      airport: 7.5,
      sparse: 12,
    },
    provider: {
      uber: 1.0,
      lyft: 1.18,
      curb: 1.05,
      empower: 1.55,
      other: 1.25,
    },
    category: {
      STANDARD: 1,
      ECONOMY: 1.05,
      TAXI: 1,
      XL: 1.35,
      PREMIUM: 1.22,
      LUXURY: 1.55,
      WAV: 1.9,
      ACCESSIBLE: 1.9,
      SHARED: 1.15,
      EV: 1.08,
      OTHER: 1.2,
    },
    capMinutes: { core: 14, sparse: 28 },
    floorMinutes: 1.5,
  },
};
