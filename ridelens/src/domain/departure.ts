/**
 * "When should I leave?"
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONE FORWARD-LOOKING QUESTION RIDELENS IS ALLOWED TO ANSWER           │
 * │                                                                          │
 * │ A regulated fare is a published rule on a clock. New York adds $2.50     │
 * │ between 4pm and 8pm on weekdays; Metro-North charges $13.75 for a peak   │
 * │ train and $10.25 for the same seat off-peak. Those are not forecasts —   │
 * │ they are the tariff, and the same measured route can be priced at any    │
 * │ minute of the day with exactly the certainty it is priced with now.      │
 * │                                                                          │
 * │ So this module turns a set of quotes into the answer to the question a   │
 * │ rider actually has once they know the price: *is now a good time?* It    │
 * │ exists for tariff-priced modes only. There is no equivalent for a        │
 * │ market-priced provider, and inventing one would be a forecast wearing    │
 * │ the clothes of a fact.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import type { FareBand } from './fareclock';
import type { ProviderId } from './quote';

export const MINUTES_PER_DAY = 1440;

/** One priceable option whose fare moves across the day. */
export interface DepartureOption {
  id: string;
  provider: ProviderId;
  /** The provider's own name for it, e.g. "JFK ↔ Manhattan flat fare". */
  label: string;
  currency: string;
  /** Ordered by clock; exactly the bands the source published. */
  bands: FareBand[];
}

/**
 * What this option costs for a departure `offset` minutes from now.
 *
 * Bands already tile the next 24 hours without gaps, so this is a lookup
 * rather than a resolution step — the sampler did that work.
 */
export function priceAtOffset(
  bands: readonly FareBand[],
  offset: number,
): { minMinor: number; maxMinor: number } | null {
  const o = Math.min(MINUTES_PER_DAY - 1, Math.max(0, offset));
  const hit = bands.find((b) => o >= b.fromOffset && o < b.toOffset);
  return hit ? { minMinor: hit.minMinor, maxMinor: hit.maxMinor } : null;
}

/**
 * How far ahead a saving is still a plan rather than trivia.
 *
 * Told at nine in the morning that something is cheaper at midnight, a rider
 * has been handed a fact they cannot use. Eight hours covers "wait for the
 * evening rate" and stops well short of that.
 */
export const ADVICE_HORIZON_MINUTES = 8 * 60;

/** How soon a rise counts as urgent enough to lead with. */
export const RISE_HORIZON_MINUTES = 2 * 60;

export type DepartureAdviceKind =
  /** It goes up soon enough that the rider should decide now. */
  | 'RISES_SOON'
  /** Waiting is worth real money within the horizon. */
  | 'SAVE_BY_WAITING'
  /** Already on the lowest rate this option has; here is when that ends. */
  | 'HOLDS_UNTIL';

export interface DepartureAdvice {
  kind: DepartureAdviceKind;
  optionId: string;
  optionLabel: string;
  provider: ProviderId;
  currency: string;
  /** The market's wall clock at which the price changes, "20:00". */
  atLabel: string;
  /** Minutes from now until then. */
  inMinutes: number;
  /** True when that clock time falls after the next midnight. */
  nextDay: boolean;
  nowMinor: number;
  thenMinor: number;
  /** Absolute difference, always positive. */
  deltaMinor: number;
}

/**
 * The single most useful thing to say about timing, across every option.
 *
 * Ranked by what a rider can act on. A rise inside two hours beats everything,
 * because it is a decision rather than a plan. After that, candidates are
 * ordered by how much the timing changes the fare *in proportion to it* — the
 * question this panel exists to answer is "for which option does when I leave
 * actually matter?", and proportion is what measures that.
 *
 * Absolute money gets this wrong in a way that showed up the first time two
 * modes appeared together. Chelsea to Scarsdale offers a $127 taxi that falls
 * a dollar overnight and a $10.25 train that costs $3.50 more at peak. By the
 * dollar the taxi wins and the headline reads "licensed taxi drops $1.00" —
 * true, and worth nobody's attention. By proportion it is 0.8% against 34%,
 * and the rider is told the thing that could a third of their fare.
 *
 * Failing everything, saying "you are already on the cheapest rate, and here is
 * when that ends" is a real answer; generic filler about dragging the timeline
 * is not.
 */
export function planDeparture(options: readonly DepartureOption[]): DepartureAdvice | null {
  const rises: DepartureAdvice[] = [];
  const savings: DepartureAdvice[] = [];
  const holds: DepartureAdvice[] = [];

  for (const option of options) {
    const now = priceAtOffset(option.bands, 0);
    if (!now || option.bands.length < 2) continue;

    // The first change is the whole decision; what happens after it is a
    // different one, taken later.
    const change = option.bands.find((b) => b.fromOffset > 0 && b.minMinor !== now.minMinor);
    if (!change) continue;

    const cheapest = Math.min(...option.bands.map((b) => b.minMinor));
    const kind: DepartureAdviceKind =
      change.minMinor < now.minMinor
        ? 'SAVE_BY_WAITING'
        : now.minMinor === cheapest
          ? 'HOLDS_UNTIL'
          : 'RISES_SOON';

    const startClock = clockMinutes(option.bands[0]?.fromLabel ?? '00:00');
    const advice: DepartureAdvice = {
      kind,
      optionId: option.id,
      optionLabel: option.label,
      provider: option.provider,
      currency: option.currency,
      atLabel: change.fromLabel,
      inMinutes: change.fromOffset,
      nextDay: startClock + change.fromOffset >= MINUTES_PER_DAY,
      nowMinor: now.minMinor,
      thenMinor: change.minMinor,
      deltaMinor: Math.abs(change.minMinor - now.minMinor),
    };

    if (kind === 'SAVE_BY_WAITING') savings.push(advice);
    else if (kind === 'HOLDS_UNTIL') holds.push(advice);
    else rises.push(advice);
  }

  const bySoonest = (a: DepartureAdvice, b: DepartureAdvice) => a.inMinutes - b.inMinutes;
  const share = (a: DepartureAdvice) => a.deltaMinor / Math.max(1, a.nowMinor);
  const byWeight = (a: DepartureAdvice, b: DepartureAdvice) =>
    share(b) - share(a) || b.deltaMinor - a.deltaMinor || a.inMinutes - b.inMinutes;

  const urgent = rises.filter((r) => r.inMinutes <= RISE_HORIZON_MINUTES).sort(bySoonest)[0];
  if (urgent) return urgent;

  const soon = savings.filter((s) => s.inMinutes <= ADVICE_HORIZON_MINUTES).sort(byWeight)[0];
  if (soon) return soon;

  return [...savings, ...holds, ...rises].sort(byWeight)[0] ?? null;
}

function clockMinutes(label: string): number {
  const [h = 0, m = 0] = label.split(':').map(Number);
  return h * 60 + m;
}

/** The market's wall clock `offset` minutes after `fromLabel`-time zero. */
export function clockAfter(startLabel: string, offset: number): string {
  const [h = 0, m = 0] = startLabel.split(':').map(Number);
  const total = (h * 60 + m + offset) % MINUTES_PER_DAY;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "in 25 min", "in 3 hr 10 min" — for advice that is about to matter. */
export function formatLead(minutes: number): string {
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `in ${h} hr` : `in ${h} hr ${m} min`;
}
