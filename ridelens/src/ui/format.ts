/**
 * Display formatting. The rules that keep the UI honest live here.
 *
 * Cardinal rule: a range is rendered as a range. The midpoint exists only in
 * rankingPriceMinor, is never printed, and is never spoken to a screen reader.
 */
import { formatMoney, formatRange } from '@/domain/money';
import type { NormalizedQuote, PriceType } from '@/domain/quote';

export interface PriceDisplay {
  /** What the eye reads, e.g. "$27–34" or "$23.84". */
  text: string;
  /** Short semantics label, e.g. "Upfront", "Est.". */
  qualifier: string | null;
  /** Full sentence for assistive technology. */
  ariaLabel: string;
}

const QUALIFIER: Record<PriceType, string | null> = {
  UPFRONT_QUOTE: 'Upfront',
  ESTIMATE: 'Est.',
  ESTIMATE_RANGE: 'Est. range',
  METERED_ESTIMATE: 'Metered est.',
  UNKNOWN: 'Unpriced',
};

export function priceDisplay(q: NormalizedQuote): PriceDisplay {
  const qualifier = QUALIFIER[q.priceType];

  if (q.priceType === 'UNKNOWN') {
    return {
      text: 'Price unavailable',
      qualifier: null,
      ariaLabel: `${q.providerProductName}: price unavailable`,
    };
  }

  if (q.priceType === 'ESTIMATE_RANGE' && q.priceMinMinor !== q.priceMaxMinor) {
    const text = formatRange(q.priceMinMinor, q.priceMaxMinor, q.currency);
    return {
      text,
      qualifier,
      ariaLabel: `${q.providerProductName}: estimated between ${spoken(q.priceMinMinor, q.currency)} and ${spoken(q.priceMaxMinor, q.currency)}`,
    };
  }

  const text = formatMoney(q.displayPriceMinor, q.currency);
  const lead =
    q.priceType === 'UPFRONT_QUOTE'
      ? 'upfront fare'
      : q.priceType === 'METERED_ESTIMATE'
        ? 'estimated metered fare'
        : 'estimated fare';
  return {
    text,
    qualifier,
    ariaLabel: `${q.providerProductName}: ${lead} ${spoken(q.displayPriceMinor, q.currency)}`,
  };
}

/** Currency spoken in words so a screen reader does not read "$" as "dollar sign". */
export function spoken(minor: number, currency: string): string {
  const formatted = formatMoney(minor, currency);
  const names: Record<string, [string, string]> = {
    USD: ['dollars', 'cents'],
    CAD: ['Canadian dollars', 'cents'],
    EUR: ['euros', 'cents'],
    GBP: ['pounds', 'pence'],
    AUD: ['Australian dollars', 'cents'],
    MXN: ['Mexican pesos', 'centavos'],
  };
  const pair = names[currency];
  if (!pair) return formatted;
  const whole = Math.trunc(Math.abs(minor) / 100);
  const frac = Math.abs(minor) % 100;
  return frac === 0 ? `${whole} ${pair[0]}` : `${whole} ${pair[0]} ${frac} ${pair[1]}`;
}

/** Pickup ETA. Deliberately distinct wording from trip duration. */
export function formatEta(seconds: number | null): string {
  if (seconds === null) return 'ETA unknown';
  if (seconds < 60) return '<1 min';
  return `${Math.round(seconds / 60)} min`;
}

export function formatEtaAria(seconds: number | null): string {
  if (seconds === null) return 'pickup time unknown';
  if (seconds < 60) return 'pickup in under a minute';
  return `pickup in about ${Math.round(seconds / 60)} minutes`;
}

/**
 * Whole minutes, for prose that supplies its own noun.
 *
 * Lives here rather than at the call site because this module is the one place
 * the money lint rule is relaxed — seconds are not currency, and the exemption
 * list should not have to grow every time a component needs to say "37 min".
 */
/**
 * Metres as the distance a rider thinks in.
 *
 * Shared by the verdict and the journey strip so that one trip cannot describe
 * the same leg as "0.8 mi" in one place and "a few steps" in another.
 */
export function milesLabel(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.2 ? 'a few steps' : `${miles.toFixed(1)} mi`;
}

export function minutesOf(seconds: number): number {
  return Math.round(seconds / 60);
}

export function formatTripDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const min = Math.round(seconds / 60);
  return `${min} min trip`;
}
