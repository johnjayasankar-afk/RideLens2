import type { NormalizedQuote, QuoteType } from "./types";

export function dollarsToMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function minorToDollars(minor: number): number {
  return minor / 100;
}

export function formatMoneyMinor(
  minor: number,
  currency = "USD",
  locale = "en-US",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minorToDollars(minor));
}

export function formatMoneyRange(
  minMinor: number,
  maxMinor: number,
  currency = "USD",
): string {
  if (minMinor === maxMinor) return formatMoneyMinor(minMinor, currency);
  return `${formatMoneyMinor(minMinor, currency)}–${formatMoneyMinor(maxMinor, currency).replace(/^[^\d-]*/, "")}`;
}

/** Display-facing price. Never invent a midpoint for the user. */
export function formatQuotePrice(quote: Pick<
  NormalizedQuote,
  | "priceType"
  | "priceMinMinor"
  | "priceMaxMinor"
  | "displayPriceMinor"
  | "currency"
>): string {
  const currency = quote.currency || "USD";
  const isRange =
    quote.priceType === "ESTIMATE_RANGE" ||
    quote.priceMinMinor !== quote.priceMaxMinor;

  let body: string;
  if (isRange) {
    body = formatMoneyRange(
      quote.priceMinMinor,
      quote.priceMaxMinor,
      currency,
    );
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
