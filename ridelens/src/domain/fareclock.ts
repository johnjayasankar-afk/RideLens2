/**
 * When a regulated fare changes, and by how much.
 *
 * A municipal tariff is a published rule, not a prediction: night and rush-hour
 * surcharges switch on and off at fixed local times. That means the same
 * measured route can be priced at any clock time with exactly the same
 * certainty as pricing it now — no forecasting, no modelling of demand, no
 * guess about what a market-priced provider will do an hour from now.
 *
 * So this is the one forward-looking number in RideLens that is allowed to
 * exist. It answers two questions a rider actually asks:
 *
 *   "If I wait, is it cheaper?"     → `cheaper`
 *   "If I dawdle, does it go up?"   → `rises`
 *
 * It is deliberately limited to tariff-priced quotes. There is no equivalent
 * for Uber or Lyft, and inventing one would be exactly the kind of confident
 * fiction this product exists to avoid.
 */

import { localTimeIn, minutesSinceMidnight, type LocalTime } from '@/domain/geo';
import { computeFare, type FareContext, type RouteMeasurement, type Tariff } from '@/domain/tariff';

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;

/**
 * How far ahead to look for a cheaper fare. Four hours keeps the advice
 * actionable: "cheaper after 20:00" told at 09:00 is trivia, not help.
 */
export const CHEAPER_HORIZON_MINUTES = 4 * 60;

/**
 * How far ahead to warn about a rise. Ninety minutes is roughly the window in
 * which someone might still be deciding whether to leave now.
 */
export const RISE_HORIZON_MINUTES = 90;

export interface FareChange {
  /** Minutes from now until this price takes effect. Always > 0. */
  inMinutes: number;
  /** Local wall clock at the market, "20:00". */
  atLabel: string;
  minMinor: number;
  maxMinor: number;
  /** Signed difference against the fare right now, on the low end. */
  deltaMinor: number;
}

export interface FareOutlook {
  nowMinMinor: number;
  nowMaxMinor: number;
  /** The soonest strictly cheaper price within the horizon, if any. */
  cheaper: FareChange | null;
  /** The soonest strictly dearer price within the horizon, if any. */
  rises: FareChange | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function label(t: LocalTime): string {
  return `${pad2(t.hour)}:${pad2(t.minute)}`;
}

/**
 * The next instant at which the market's wall clock reads `targetMin`.
 *
 * Adding a fixed number of minutes is right except across a DST transition,
 * where the wall clock jumps and the arithmetic lands an hour off. Rather than
 * trust it, we re-read the local time of the candidate and correct once by the
 * residual. One pass converges for any standard transition; if a market ever
 * did something stranger, the label still reports the truth about the instant
 * we actually priced, so the number shown can never disagree with itself.
 */
function nextLocalTimeAt(timeZone: string, from: Date, targetMin: number): Date {
  const nowMin = minutesSinceMidnight(localTimeIn(timeZone, from));
  const naive = (targetMin - nowMin + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  let candidate = new Date(from.getTime() + naive * MS_PER_MINUTE);

  const landedMin = minutesSinceMidnight(localTimeIn(timeZone, candidate));
  let residual = targetMin - landedMin;
  if (residual > MINUTES_PER_DAY / 2) residual -= MINUTES_PER_DAY;
  if (residual < -MINUTES_PER_DAY / 2) residual += MINUTES_PER_DAY;
  if (residual !== 0) {
    candidate = new Date(candidate.getTime() + residual * MS_PER_MINUTE);
  }
  return candidate;
}

/**
 * Every local minute at which this tariff could change price: the edges of each
 * time window, and midnight for the weekday/weekend boundary. A fare can only
 * change at one of these, so pricing each one covers the whole day exactly.
 */
function boundaryMinutes(tariff: Tariff): number[] {
  const set = new Set<number>();
  let needsMidnight = false;
  for (const s of tariff.surcharges) {
    const w = s.when;
    if (!w) continue;
    if (w.weekdaysOnly) needsMidnight = true;
    if (w.window) {
      set.add(w.window.startMin % MINUTES_PER_DAY);
      set.add(w.window.endMin % MINUTES_PER_DAY);
    }
  }
  if (needsMidnight) set.add(0);
  return [...set].sort((a, b) => a - b);
}

/**
 * Price the same measured route at each upcoming tariff boundary.
 *
 * Returns null when this tariff has no time-varying component at all — there is
 * nothing to say, and saying nothing is better than "the price will not change"
 * dressed up as insight.
 */
export function fareOutlook(
  tariff: Tariff,
  route: RouteMeasurement,
  ctx: FareContext,
): FareOutlook | null {
  const boundaries = boundaryMinutes(tariff);
  if (boundaries.length === 0) return null;

  const from = ctx.at ?? new Date();
  const now = computeFare(tariff, route, { ...ctx, at: from });

  // A flat fare between two zones is fixed by rule; time-of-day surcharges that
  // ride on top of it are still real, so it is only excluded if nothing moves.
  const changes: FareChange[] = [];
  for (const b of boundaries) {
    const at = nextLocalTimeAt(tariff.timeZone, from, b);
    const inMinutes = Math.round((at.getTime() - from.getTime()) / MS_PER_MINUTE);
    if (inMinutes <= 0) continue;
    const fare = computeFare(tariff, route, { ...ctx, at });
    if (fare.minMinor === now.minMinor && fare.maxMinor === now.maxMinor) continue;
    changes.push({
      inMinutes,
      atLabel: label(fare.localTime),
      minMinor: fare.minMinor,
      maxMinor: fare.maxMinor,
      deltaMinor: fare.minMinor - now.minMinor,
    });
  }
  changes.sort((a, b) => a.inMinutes - b.inMinutes);

  const cheaper =
    changes.find(
      (c) =>
        c.inMinutes <= CHEAPER_HORIZON_MINUTES &&
        c.minMinor < now.minMinor &&
        c.maxMinor < now.maxMinor,
    ) ?? null;
  const rises =
    changes.find(
      (c) =>
        c.inMinutes <= RISE_HORIZON_MINUTES &&
        c.minMinor > now.minMinor &&
        c.maxMinor > now.maxMinor,
    ) ?? null;

  if (!cheaper && !rises) return null;
  return { nowMinMinor: now.minMinor, nowMaxMinor: now.maxMinor, cheaper, rises };
}

export interface FarePoint {
  /** Minutes from the instant the day was sampled. 0 is that instant. */
  offsetMinutes: number;
  /** The market's wall clock when this price applies, "16:00". */
  label: string;
  minMinor: number;
  maxMinor: number;
}

/**
 * The next 24 hours of fares for this route, as a curve.
 *
 * The same argument as `fareOutlook`, taken to its conclusion: if the tariff is
 * a published rule then every hour ahead is knowable, not just the next
 * change. So instead of one sentence about the next boundary, a rider can see
 * the shape — the overnight step, the rush-hour block, the cheap window at
 * eleven in the morning — and decide when to travel.
 */
export function fareByHour(tariff: Tariff, route: RouteMeasurement, ctx: FareContext): FarePoint[] {
  return sampleFareDay({
    timeZone: tariff.timeZone,
    from: ctx.at,
    boundaries: boundaryMinutes(tariff),
    priceAt: (at) => computeFare(tariff, route, { ...ctx, at }),
  });
}

/**
 * The same sampling, for anything whose price is a published rule on a clock.
 *
 * A taxi meter is not the only fare that moves on the hour: a commuter railroad
 * charges peak and off-peak, and that is the same kind of fact — a rule the
 * authority wrote down, priceable at any minute with no forecasting. Keeping
 * the sampler generic is what lets the day view cover every mode rather than
 * being a taxi feature that quietly excludes the train.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS RUNS FORWARD FROM NOW RATHER THAN AROUND A CLOCK FACE           │
 * │                                                                          │
 * │ Sampling "the next 03:30, the next 04:00, …" and then laying the results │
 * │ out on a midnight-to-midnight axis quietly splices two different days    │
 * │ together: the hours after now come from today, the hours before it from  │
 * │ tomorrow. Most of the week that is invisible. On a Friday evening, or on │
 * │ a public holiday, it is a lie — New York's rush-hour surcharge is        │
 * │ weekdays-only, so on Labor Day the strip showed a 4pm surcharge that     │
 * │ nobody would be charged, contradicting the very quote beside it.         │
 * │                                                                          │
 * │ Offsets from now are elapsed minutes, so every sample is a real instant  │
 * │ in the rider's future and the day turns over in the right place. Labels  │
 * │ are read back off that instant, which also makes them correct across a   │
 * │ daylight-saving transition without any arithmetic to get wrong.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `boundaries` are the local minutes at which this particular thing can change
 * price. Everything else is sampled every half hour, which is fine because
 * consecutive equal prices collapse in `fareBands`.
 */
export function sampleFareDay(args: {
  timeZone: string;
  /** Defaults to now. The 24 hours sampled start at this instant. */
  from?: Date;
  boundaries: readonly number[];
  priceAt: (at: Date) => { minMinor: number; maxMinor: number };
}): FarePoint[] {
  const from = args.from ?? new Date();
  const nowClock = minutesSinceMidnight(localTimeIn(args.timeZone, from));

  const offsets = new Set<number>([0]);
  for (let m = 30; m < MINUTES_PER_DAY; m += 30) offsets.add(m);
  for (const boundary of args.boundaries) {
    offsets.add(mod1440(boundary - nowClock));
  }

  return [...offsets]
    .sort((a, b) => a - b)
    .map((offsetMinutes) => {
      const at = new Date(from.getTime() + offsetMinutes * MS_PER_MINUTE);
      const fare = args.priceAt(at);
      return {
        offsetMinutes,
        label: label(localTimeIn(args.timeZone, at)),
        minMinor: fare.minMinor,
        maxMinor: fare.maxMinor,
      };
    });
}

function mod1440(m: number): number {
  return ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * The curve reduced to the bands a person would actually describe.
 *
 * Consecutive samples at the same price collapse into one span, so "overnight
 * costs a dollar more from 8pm to 6am" is one row rather than twenty-four.
 * Returns null when the fare never moves — there is no chart worth drawing for
 * a flat line, and drawing one anyway would imply a variation that is not there.
 *
 * `toOffset` is the moment the price *changes*, which is the next band's start
 * rather than this band's own last sample. That distinction is the difference
 * between "peak ends at 19:30" and the truth, which is 20:00.
 */
export interface FareBand {
  /** Minutes from now at which this price takes effect. The first band is 0. */
  fromOffset: number;
  /** Minutes from now at which it stops. The last band runs to 1440. */
  toOffset: number;
  /** The market's wall clock at `fromOffset`, "16:00". */
  fromLabel: string;
  /** The market's wall clock at `toOffset` — when this price ends. */
  toLabel: string;
  minMinor: number;
  maxMinor: number;
}

export function fareBands(points: FarePoint[]): FareBand[] | null {
  if (points.length === 0) return null;
  const distinct = new Set(points.map((p) => `${p.minMinor}:${p.maxMinor}`));
  if (distinct.size <= 1) return null;

  const bands: FareBand[] = [];
  for (const p of points) {
    const last = bands[bands.length - 1];
    if (last && last.minMinor === p.minMinor && last.maxMinor === p.maxMinor) continue;
    if (last) {
      last.toOffset = p.offsetMinutes;
      last.toLabel = p.label;
    }
    bands.push({
      fromOffset: p.offsetMinutes,
      toOffset: MINUTES_PER_DAY,
      fromLabel: p.label,
      toLabel: p.label,
      minMinor: p.minMinor,
      maxMinor: p.maxMinor,
    });
  }

  const last = bands[bands.length - 1];
  if (last) {
    last.toOffset = MINUTES_PER_DAY;
    // 24 hours from now is the same wall clock we started at.
    last.toLabel = points[0]?.label ?? last.toLabel;
  }
  return bands;
}
