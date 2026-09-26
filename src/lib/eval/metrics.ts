/**
 * Does the model actually work?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ RideLens rests entirely on a modeled number and has had no mechanism     │
 * │ that could ever tell anyone it was wrong. Every other honesty measure in │
 * │ this codebase — the provenance chip, the widened bands, the refusal to   │
 * │ show a midpoint — describes how the number was made. None of them        │
 * │ describes whether it was right.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── Why coverage alone is worthless ────────────────────────────────────────
 *
 * A band of $5–$500 contains every fare that has ever been charged. It scores
 * 100% coverage and tells a rider nothing. Coverage and sharpness are only
 * meaningful together, and any report that gives one without the other is
 * marketing. Every function here returns both, and the report refuses to print
 * one alone.
 *
 * ── Why there is a minimum n ───────────────────────────────────────────────
 *
 * Three rides is not a calibration. Statistics below MIN_SAMPLES are withheld
 * rather than shown with a caveat, because a number on a page is read and a
 * caveat beside it is not.
 */

/** Below this, a statistic is withheld rather than published with a warning. */
export const MIN_SAMPLES = 20;

export interface ActualRecord {
  /** Stable identifier for the route, so corridors can be grouped. */
  routeHash: string;
  provider: string;
  productId?: string;
  marketId?: string;
  /** The band RideLens predicted, in minor units, at the time. */
  predictedMinMinor: number;
  predictedMaxMinor: number;
  /** What the rider actually paid, in minor units. */
  actualMinor: number;
  /** When the prediction was made — for hour-of-day grouping. */
  predictedAt: string;
  modelVersion?: string;
  distanceMeters?: number;
  /**
   * The pickup wait band RideLens predicted, in seconds, and what actually
   * happened. Optional: a fare can be reported without one, and most are.
   *
   * The wait model was the least examined thing in the product — parameters
   * attributed to studies nobody could find, a band shown on every card, and
   * no mechanism that could ever say whether it was right. It is scored
   * separately from price because a model can be good at one and useless at
   * the other, and an average across both would hide exactly that.
   */
  predictedWaitLowSeconds?: number;
  predictedWaitHighSeconds?: number;
  actualWaitSeconds?: number;
}

export interface Interval {
  min: number;
  max: number;
}

/** The centre of a band. Used for error, never shown to a rider. */
export function midpoint(i: Interval): number {
  return (i.min + i.max) / 2;
}

export function contains(i: Interval, value: number): boolean {
  return value >= i.min && value <= i.max;
}

/**
 * Where an actual fell relative to its band.
 *
 * 0 is the bottom edge, 1 the top, negative below, above 1 over. Reported
 * rather than clamped: how far outside a miss landed is the interesting part.
 */
export function position(i: Interval, value: number): number {
  const width = i.max - i.min;
  if (width <= 0) return value === i.min ? 0.5 : value < i.min ? -1 : 2;
  return (value - i.min) / width;
}

export interface Summary {
  n: number;
  /** Fraction of actuals inside the band. Null below MIN_SAMPLES. */
  coverage: number | null;
  /** Mean band width in minor units. Null below MIN_SAMPLES. */
  meanWidthMinor: number | null;
  /** Mean width as a fraction of the midpoint — comparable across markets. */
  meanRelativeWidth: number | null;
  /** Mean signed error (actual − midpoint) in minor units. */
  biasMinor: number | null;
  /** The same as a fraction of the midpoint. Positive = we underquote. */
  biasRelative: number | null;
  /** Mean absolute error, so over- and under-shoots do not cancel. */
  maeMinor: number | null;
  /** Of the misses, the share that fell below the band. */
  missedLowShare: number | null;
}

const withheld = (n: number): Summary => ({
  n,
  coverage: null,
  meanWidthMinor: null,
  meanRelativeWidth: null,
  biasMinor: null,
  biasRelative: null,
  maeMinor: null,
  missedLowShare: null,
});

export function summarise(records: readonly ActualRecord[]): Summary {
  const n = records.length;
  if (n < MIN_SAMPLES) return withheld(n);

  let inside = 0;
  let width = 0;
  let relWidth = 0;
  let bias = 0;
  let relBias = 0;
  let abs = 0;
  let missLow = 0;
  let misses = 0;

  for (const r of records) {
    const band: Interval = { min: r.predictedMinMinor, max: r.predictedMaxMinor };
    const mid = midpoint(band);
    const err = r.actualMinor - mid;

    if (contains(band, r.actualMinor)) inside += 1;
    else {
      misses += 1;
      if (r.actualMinor < band.min) missLow += 1;
    }

    width += band.max - band.min;
    relWidth += mid > 0 ? (band.max - band.min) / mid : 0;
    bias += err;
    relBias += mid > 0 ? err / mid : 0;
    abs += Math.abs(err);
  }

  return {
    n,
    coverage: inside / n,
    meanWidthMinor: width / n,
    meanRelativeWidth: relWidth / n,
    biasMinor: bias / n,
    biasRelative: relBias / n,
    maeMinor: abs / n,
    missedLowShare: misses === 0 ? null : missLow / misses,
  };
}

/**
 * One number that cannot be gamed by widening the band.
 *
 * Coverage rises to 1 as the band grows and sharpness falls at the same time,
 * so either alone is a dial a careless engineer can turn. This rewards
 * coverage and penalises width, which means the only way to improve it is to
 * be right more often *without* hedging — which is what "the model got better"
 * should mean.
 *
 * Null below MIN_SAMPLES, like everything else here.
 */
export function coverageAdjustedSharpness(s: Summary): number | null {
  if (s.coverage === null || s.meanRelativeWidth === null) return null;
  /*
   * Squared, not linear. With `coverage / (1 + w)` a band stretching from
   * $500 to $50,000 around a $25 fare — width almost twice the fare — still
   * scored 0.34, which reads as merely mediocre in a published document. The
   * ordering was right and the number was not, and this report exists to be
   * read by people who will take the number at face value.
   *
   * A zero-width band that always contains the actual scores 1. A band as wide
   * as the fare itself scores a quarter of its coverage.
   */
  const w = 1 + s.meanRelativeWidth;
  return s.coverage / (w * w);
}

export interface CalibrationPoint {
  /** The band shrunk toward its centre to this fraction of its half-width. */
  bandFraction: number;
  /** How often the actual still landed inside. */
  observedCoverage: number;
}

/**
 * Coverage as the band is squeezed.
 *
 * With interval predictions rather than full distributions, this is the
 * honest analogue of a calibration plot: shrink every band toward its centre
 * and watch how fast coverage falls away. A well-shaped band loses coverage
 * smoothly and roughly in proportion; one that drops off a cliff near the
 * centre is wide for no reason, and one that barely moves is being carried by
 * a handful of outliers.
 */
export function calibrationCurve(
  records: readonly ActualRecord[],
  fractions: readonly number[] = [0.2, 0.4, 0.6, 0.8, 1],
): CalibrationPoint[] {
  if (records.length < MIN_SAMPLES) return [];
  return fractions.map((f) => {
    let inside = 0;
    for (const r of records) {
      const band: Interval = { min: r.predictedMinMinor, max: r.predictedMaxMinor };
      const mid = midpoint(band);
      const half = ((band.max - band.min) / 2) * f;
      if (contains({ min: mid - half, max: mid + half }, r.actualMinor)) inside += 1;
    }
    return { bandFraction: f, observedCoverage: inside / records.length };
  });
}

export type GroupKey = "provider" | "marketId" | "hour" | "distanceBand";

/** Buckets a record falls into, for per-slice reporting. */
export function groupValue(record: ActualRecord, key: GroupKey): string {
  switch (key) {
    case "provider":
      return record.provider;
    case "marketId":
      return record.marketId ?? "unknown";
    case "hour": {
      const h = new Date(record.predictedAt).getUTCHours();
      return Number.isNaN(h) ? "unknown" : `${String(h).padStart(2, "0")}:00`;
    }
    case "distanceBand": {
      const m = record.distanceMeters;
      if (m == null || !Number.isFinite(m)) return "unknown";
      const miles = m / 1609.344;
      if (miles < 2) return "<2 mi";
      if (miles < 5) return "2–5 mi";
      if (miles < 12) return "5–12 mi";
      return "12+ mi";
    }
  }
}

export function groupBy(
  records: readonly ActualRecord[],
  key: GroupKey,
): Map<string, ActualRecord[]> {
  const out = new Map<string, ActualRecord[]>();
  for (const r of records) {
    const g = groupValue(r, key);
    const list = out.get(g);
    if (list) list.push(r);
    else out.set(g, [r]);
  }
  return out;
}

/**
 * How the wait model did, on the rows that carried a wait.
 *
 * Same withholding rule as everything else: below MIN_SAMPLES it reports the
 * count and nothing else. Sharpness is in seconds rather than relative,
 * because a minute is a minute whether the wait is two or twenty — the thing
 * a rider notices is the absolute miss.
 */
export interface WaitSummary {
  n: number;
  coverage: number | null;
  /** Mean signed error in seconds. Positive = we said the car was closer. */
  biasSeconds: number | null;
  meanAbsErrorSeconds: number | null;
  meanWidthSeconds: number | null;
}

const waitWithheld = (n: number): WaitSummary => ({
  n,
  coverage: null,
  biasSeconds: null,
  meanAbsErrorSeconds: null,
  meanWidthSeconds: null,
});

export function summariseWait(records: readonly ActualRecord[]): WaitSummary {
  const scorable = records.filter(
    (r) =>
      r.actualWaitSeconds != null &&
      r.predictedWaitLowSeconds != null &&
      r.predictedWaitHighSeconds != null,
  );
  const n = scorable.length;
  if (n < MIN_SAMPLES) return waitWithheld(n);

  let inside = 0;
  let bias = 0;
  let abs = 0;
  let width = 0;

  for (const r of scorable) {
    const band: Interval = { min: r.predictedWaitLowSeconds!, max: r.predictedWaitHighSeconds! };
    const actual = r.actualWaitSeconds!;
    if (contains(band, actual)) inside += 1;
    const err = actual - midpoint(band);
    bias += err;
    abs += Math.abs(err);
    width += band.max - band.min;
  }

  return {
    n,
    coverage: inside / n,
    biasSeconds: bias / n,
    meanAbsErrorSeconds: abs / n,
    meanWidthSeconds: width / n,
  };
}

export interface EvalReport {
  generatedAt: string;
  overall: Summary;
  score: number | null;
  curve: CalibrationPoint[];
  slices: Record<GroupKey, Array<{ group: string; summary: Summary }>>;
  /** Scored separately — a model can be good at price and useless at wait. */
  wait: WaitSummary;
  /** Model versions present in the corpus, so a mixed one is visible. */
  modelVersions: string[];
}

export function evaluate(records: readonly ActualRecord[]): EvalReport {
  const overall = summarise(records);
  const keys: GroupKey[] = ["provider", "marketId", "hour", "distanceBand"];
  const slices = Object.fromEntries(
    keys.map((k) => [
      k,
      [...groupBy(records, k).entries()]
        .map(([group, rs]) => ({ group, summary: summarise(rs) }))
        .sort((a, b) => b.summary.n - a.summary.n),
    ]),
  ) as EvalReport["slices"];

  return {
    generatedAt: new Date().toISOString(),
    overall,
    score: coverageAdjustedSharpness(overall),
    curve: calibrationCurve(records),
    slices,
    wait: summariseWait(records),
    modelVersions: [...new Set(records.map((r) => r.modelVersion ?? "unknown"))].sort(),
  };
}
