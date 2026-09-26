/**
 * What it costs each, and when a bigger car starts being the cheaper one.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Five people looking at a board sorted by total price read it wrong. An   │
 * │ UberX at $70 is not $70 for five of them — it is two cars. UberXL at     │
 * │ $110 looks like the expensive option right up until the moment it is the │
 * │ cheap one, and nothing on the screen marks where that happens.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── The thing this must not quietly do ─────────────────────────────────────
 *
 * Two cars is not two times one car, and presenting it as such would be a new
 * fabrication on top of an honest estimate. They are two separate requests:
 * each gets its own surge, its own driver, its own wait, and they do not
 * arrive together. The multiplication is arithmetic the rider could do; the
 * claim that the answer is *a price* is not.
 *
 * So a multi-vehicle figure is always marked as one, always widened, and the
 * copy never calls it a fare. What is honest is the comparison — two cars
 * versus one bigger one, under the same assumption — and that is what the
 * crossover reports.
 */

import type { NormalizedQuote, RideCategory } from "./types";

/**
 * Seats a rider can actually use, by category.
 *
 * Conservative on purpose. These are the numbers the apps advertise, and the
 * apps are describing seatbelts rather than luggage; a party of four with
 * bags does not fit a sedan the way a party of four does.
 */
export const SEATS: Partial<Record<RideCategory, number>> = {
  STANDARD: 4,
  ECONOMY: 4,
  TAXI: 4,
  PREMIUM: 4,
  LUXURY: 4,
  EV: 4,
  SHARED: 2,
  XL: 6,
  ACCESSIBLE: 4,
  AUTONOMOUS: 4,
  OTHER: 4,
};

/** Above this, it is a coach booking and not a thing this product models. */
export const MAX_PARTY = 12;
/** More than this many cars and the estimate is not worth showing. */
export const MAX_VEHICLES = 3;

export function seatsFor(category: RideCategory): number {
  return SEATS[category] ?? 4;
}

export interface PerPersonQuote {
  quote: NormalizedQuote;
  /** How many of this vehicle the party needs. */
  vehicles: number;
  seats: number;
  /** Per head, in minor units. A range, never a point. */
  perPersonLowMinor: number;
  perPersonHighMinor: number;
  /** The whole party's outlay, across every vehicle. */
  partyLowMinor: number;
  partyHighMinor: number;
  /** True when this needs more than one car — see the header. */
  splitAcrossVehicles: boolean;
  /** Null when it fits; a sentence when it does not. */
  refusal: string | null;
}

/**
 * Widening applied per extra vehicle.
 *
 * Two cars requested separately get separate surge draws, so the spread of
 * the total is wider than the spread of one fare doubled. A prior, like the
 * rest of MODEL_PARAMS, and deliberately not zero — zero would assert that
 * two cars price identically, which is the exact thing that is not true.
 */
const EXTRA_VEHICLE_WIDENING = 0.08;

export function perPerson(quote: NormalizedQuote, party: number): PerPersonQuote {
  const seats = seatsFor(quote.normalizedCategory);
  const heads = Math.max(1, Math.min(MAX_PARTY, Math.round(party)));
  const vehicles = Math.ceil(heads / seats);

  const base: Omit<PerPersonQuote, "refusal"> = {
    quote,
    vehicles,
    seats,
    perPersonLowMinor: 0,
    perPersonHighMinor: 0,
    partyLowMinor: 0,
    partyHighMinor: 0,
    splitAcrossVehicles: vehicles > 1,
  };

  if (vehicles > MAX_VEHICLES) {
    return {
      ...base,
      refusal: `${heads} people needs ${vehicles} of these. That is a different kind of booking and this does not estimate it.`,
    };
  }

  const widen = 1 + (vehicles - 1) * EXTRA_VEHICLE_WIDENING;
  const low = Math.round(quote.priceMinMinor * vehicles);
  const high = Math.round(quote.priceMaxMinor * vehicles * widen);

  return {
    ...base,
    partyLowMinor: low,
    partyHighMinor: high,
    perPersonLowMinor: Math.round(low / heads),
    perPersonHighMinor: Math.round(high / heads),
    refusal: null,
  };
}

export interface Crossover {
  /** The option that is cheaper per head at this party size. */
  winner: PerPersonQuote;
  /** What it beat: the same board's best single-vehicle option. */
  loser: PerPersonQuote;
  /** Clearance per head, in minor units. Never a difference of midpoints. */
  perPersonSavingMinor: number;
  sentence: string;
}

function money(minor: number): string {
  return `$${(Math.abs(minor) / 100).toFixed(2)}`;
}

/**
 * The moment a bigger car becomes the cheaper one per head.
 *
 * Reported only when the ranges clear, for the same reason `comparePrices`
 * refuses to name a winner between overlapping bands: at five people an XL
 * and two sedans are often genuinely the same money, and a product that
 * picks one is making the choice up.
 */
export function findCrossover(rows: readonly PerPersonQuote[], party: number): Crossover | null {
  if (party < 2) return null;
  const usable = rows.filter((r) => !r.refusal);
  const single = usable.filter((r) => r.vehicles === 1);
  const split = usable.filter((r) => r.vehicles > 1);
  if (single.length === 0 || split.length === 0) return null;

  const bestSingle = single.reduce((a, b) => (b.perPersonHighMinor < a.perPersonHighMinor ? b : a));
  const bestSplit = split.reduce((a, b) => (b.perPersonLowMinor < a.perPersonLowMinor ? b : a));

  const clearance = bestSplit.perPersonLowMinor - bestSingle.perPersonHighMinor;
  if (clearance <= 0) return null;

  return {
    winner: bestSingle,
    loser: bestSplit,
    perPersonSavingMinor: clearance,
    sentence: `At ${party}, one ${bestSingle.quote.providerProductName} works out at least ${money(clearance)} a head cheaper than ${bestSplit.vehicles} × ${bestSplit.quote.providerProductName}.`,
  };
}

/** Per-head rows for a whole board, cheapest first, refusals last. */
export function splitBoard(
  quotes: readonly NormalizedQuote[],
  party: number,
): { rows: PerPersonQuote[]; crossover: Crossover | null } {
  const rows = quotes.map((q) => perPerson(q, party));
  rows.sort((a, b) => {
    if (a.refusal && !b.refusal) return 1;
    if (!a.refusal && b.refusal) return -1;
    return a.perPersonLowMinor - b.perPersonLowMinor;
  });
  return { rows, crossover: findCrossover(rows, party) };
}
