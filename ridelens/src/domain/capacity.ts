/**
 * Seat capacity.
 *
 * IMPORTANT: capacity is RideLens's own model, not provider data. No source in
 * scope reports seat counts, so this is a documented heuristic used to answer
 * "will my party of five fit?" — and it is labelled as a typical capacity
 * everywhere it is shown.
 *
 * The heuristic is deliberately conservative in the direction that matters: it
 * would rather under-promise seats than seat five people in a four-seat car.
 * When a party size cannot be satisfied with confidence, the option is filtered
 * out rather than shown with a hedge.
 */
import type { NormalizedCategory, NormalizedQuote } from './quote';

/** Passengers a category typically seats, excluding the driver. */
const CATEGORY_SEATS: Readonly<Record<NormalizedCategory, number>> = {
  STANDARD: 4,
  ECONOMY: 4,
  TAXI: 4,
  EV: 4,
  SHARED: 2,
  PREMIUM: 4,
  LUXURY: 4,
  XL: 6,
  ACCESSIBLE: 4,
  BIKE: 1,
  /**
   * A train is not a vehicle with a seat allocation. Party size never rules a
   * railroad out — it multiplies the fare instead, in domain/rail.
   */
  TRANSIT: 6,
  AUTONOMOUS: 4,
  OTHER: 4,
};

/** Product names that override the category default. */
const NAME_OVERRIDES: ReadonlyArray<{ match: RegExp; seats: number }> = [
  { match: /black suv|lux suv|luxsuv|suv/i, seats: 6 },
  { match: /\bxl\b|xl$/i, seats: 6 },
  { match: /van|minivan/i, seats: 6 },
];

export interface Capacity {
  seats: number;
  /** Always 'MODEL' today — no provider in scope reports capacity. */
  provenance: 'MODEL' | 'PROVIDER';
}

export function capacityFor(quote: {
  normalizedCategory: NormalizedCategory;
  providerProductName: string;
}): Capacity {
  for (const rule of NAME_OVERRIDES) {
    if (rule.match.test(quote.providerProductName)) {
      return { seats: rule.seats, provenance: 'MODEL' };
    }
  }
  return { seats: CATEGORY_SEATS[quote.normalizedCategory] ?? 4, provenance: 'MODEL' };
}

export const MAX_PARTY_SIZE = 6;

export function fitsParty(quote: NormalizedQuote, passengers: number): boolean {
  if (passengers <= 1) return true;
  return capacityFor(quote).seats >= passengers;
}

export function filterByParty(quotes: NormalizedQuote[], passengers: number): NormalizedQuote[] {
  if (passengers <= 1) return quotes;
  return quotes.filter((q) => fitsParty(q, passengers));
}

export const CAPACITY_DISCLOSURE =
  'Seat counts are typical capacities modelled by RideLens, not figures reported by the provider. Confirm in the provider app before booking for a large party.';
