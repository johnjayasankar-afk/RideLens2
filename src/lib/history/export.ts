/**
 * Taking the log somewhere else.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The obvious use for an export is an expense claim, and that is exactly   │
 * │ where this could do harm. A spreadsheet column headed `price` next to a  │
 * │ date and an address reads as a receipt. It is not one: RideLens never    │
 * │ saw a fare charged, only a band it modelled before the trip — and a      │
 * │ modelled estimate filed as an expense is a false statement somebody      │
 * │ else signs.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the file is built to resist that reading rather than merely disclaim it:
 *
 * - Every money column says `estimate`, never `price`, `paid`, `fare`,
 *   `total` or `amount`. A test enforces the list.
 * - The band is two columns. There is no single number to paste, because
 *   there was never a single number.
 * - A `basis` column names what produced each row, and a `model_version`
 *   column names which model, so two rows from different estimators are
 *   visibly different rows.
 * - The filename says `modeled-estimates`.
 *
 * None of that stops a determined misuse. It does stop the accidental one,
 * which is the realistic failure.
 */

import { minorToDollars } from "@/lib/domain/money";
import type { LoggedQuote, TripRecord } from "@/lib/history/trip-log";
import type { QuoteType } from "@/lib/domain/types";

/** What produced a row, in words a reader outside this codebase can check. */
export function basisOf(type: QuoteType): string {
  return type === "UPFRONT_QUOTE" ? "upfront quote held by provider" : "modeled estimate";
}

/** RFC 4180: quote anything containing a comma, a quote or a newline. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  "compared_at",
  "from",
  "to",
  "miles",
  "minutes",
  "provider",
  "product",
  "estimate_low_usd",
  "estimate_high_usd",
  "basis",
  "model_version",
] as const;

function row(record: TripRecord, quote: LoggedQuote): string {
  return [
    record.at,
    record.from.label,
    record.to.label,
    record.miles == null ? "" : record.miles.toFixed(1),
    record.minutes == null ? "" : Math.round(record.minutes),
    quote.provider,
    quote.product,
    minorToDollars(quote.lowMinor).toFixed(2),
    minorToDollars(quote.highMinor).toFixed(2),
    basisOf(quote.type),
    record.modelVersion,
  ]
    .map(csvField)
    .join(",");
}

/**
 * One row per option per comparison — not one row per comparison.
 *
 * Flattening to "the cheapest each time" would throw away the thing that
 * makes the export worth having: what the alternatives were when the choice
 * was made.
 */
export function toCsv(records: readonly TripRecord[]): string {
  const lines = [COLUMNS.join(",")];
  for (const record of records) {
    for (const quote of record.quotes) lines.push(row(record, quote));
  }
  /* A trailing newline: POSIX text, and every spreadsheet expects it. */
  return `${lines.join("\n")}\n`;
}

/** The whole log, unflattened, for anything that would rather parse JSON. */
export function toJson(records: readonly TripRecord[]): string {
  return `${JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      notice:
        "Modeled estimates recorded before each trip, not fares charged. RideLens never observes a payment.",
      records,
    },
    null,
    2,
  )}\n`;
}

export function exportFilename(kind: "csv" | "json", now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `ridelens-modeled-estimates-${day}.${kind}`;
}
