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
};
