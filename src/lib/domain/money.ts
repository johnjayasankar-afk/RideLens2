import type { NormalizedQuote, QuoteType } from "./types";

export function dollarsToMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function minorToDollars(minor: number): number {
  return minor / 100;
}

export function formatMoneyMinor(minor: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minorToDollars(minor));
}

/**
 * A range of money carries the symbol on both ends.
 *
 * This stripped the second one — "$40.51 to 42.89" — and the bare figure at
 * the end of the product's largest and most-read number reads as a quantity
 * rather than as a price. /trips prints the same range as "$41.00 to $56.80"
 * two clicks away, and the assistant was handed the stripped form as context,
 * where the symbol is the only thing marking the second figure as a currency
 * at all.
 *
 * It is also what the price column is for: right-aligned, tabular, and now
 * with a currency symbol at both ends of every row.
 *
 * The space after "to" is non-breaking. "$77.80 to $79.30" does not fit on
 * one line at 320px, and the default break put "to" at the end of the first
 * one — a connector with nothing to connect, above a figure with nothing
 * introducing it. There is one break opportunity in the string now, and it
 * gives "to $79.30", which is a phrase. `text-wrap: pretty` was tried first
 * and does not treat a full figure as an orphan.
 */
export function formatMoneyRange(minMinor: number, maxMinor: number, currency = "USD"): string {
  if (minMinor === maxMinor) return formatMoneyMinor(minMinor, currency);
  return `${formatMoneyMinor(minMinor, currency)} to\u00a0${formatMoneyMinor(maxMinor, currency)}`;
}

/** Display-facing price. Never invent a midpoint for the user. */
export function formatQuotePrice(
  quote: Pick<
    NormalizedQuote,
    "priceType" | "priceMinMinor" | "priceMaxMinor" | "displayPriceMinor" | "currency"
  >,
): string {
  const currency = quote.currency || "USD";
  const isRange =
    quote.priceType === "ESTIMATE_RANGE" || quote.priceMinMinor !== quote.priceMaxMinor;

  let body: string;
  if (isRange) {
    body = formatMoneyRange(quote.priceMinMinor, quote.priceMaxMinor, currency);
  } else {
    body = formatMoneyMinor(quote.displayPriceMinor, currency);
  }

  if (quote.priceType === "ESTIMATE" || quote.priceType === "METERED_ESTIMATE") {
    return `Est. ${body}`;
  }
  return body;
}

export function quoteTypeLabel(type: QuoteType): string {
  switch (type) {
    case "UPFRONT_QUOTE":
      return "Upfront";
    case "ESTIMATE":
      return "Estimate";
    case "ESTIMATE_RANGE":
      return "Range";
    case "METERED_ESTIMATE":
      return "Metered";
    default:
      return "Unknown";
  }
}

/** Midpoint for ranking only — never shown as the fare. */
export function rankingMidpointMinor(minMinor: number, maxMinor: number): number {
  return Math.round((minMinor + maxMinor) / 2);
}
