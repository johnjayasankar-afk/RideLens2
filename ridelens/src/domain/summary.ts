/**
 * A comparison, as plain text.
 *
 * The thing people actually do with a fare comparison is tell someone else
 * about it — in a message, in a chat, pasted into an expense note. A share link
 * is the right answer when the recipient will open it; this is the right answer
 * when they will not.
 *
 * It is written to the same standard as the screen: every price keeps its band,
 * every label keeps its certainty, and a source that returned nothing is named
 * rather than dropped. A summary that quietly rounds $27–34 to "$30" would
 * undo the whole product in one paste.
 */

import { formatMoney, formatRange } from '@/domain/money';
import type { NormalizedQuote, PriceType } from '@/domain/quote';

const CERTAINTY: Record<PriceType, string> = {
  UPFRONT_QUOTE: 'upfront',
  ESTIMATE: 'estimate',
  ESTIMATE_RANGE: 'estimated range',
  METERED_ESTIMATE: 'metered estimate',
  UNKNOWN: 'unknown',
};

export interface SummaryInput {
  pickupLabel: string;
  destinationLabel: string;
  quotes: NormalizedQuote[];
  /** Sources that answered with no price, and why. */
  unavailable: Array<{ label: string; reason: string }>;
  at: Date;
}

function priceOf(q: NormalizedQuote): string {
  return q.priceMinMinor === q.priceMaxMinor
    ? formatMoney(q.priceMinMinor, q.currency)
    : formatRange(q.priceMinMinor, q.priceMaxMinor, q.currency);
}

export function buildTripSummary(input: SummaryInput): string {
  const lines: string[] = [];
  lines.push(`${input.pickupLabel} → ${input.destinationLabel}`);

  /*
   * A scheduled comparison must not paste as a snapshot of now.
   *
   * "Checked 8 Sep, 9:41 PM · prices move, so this is a snapshot" is wrong
   * twice for a fare priced for Tuesday morning: it omits the departure the
   * numbers are actually for, and it describes a rule-fixed fare as volatile.
   * Someone reads that in a chat as today's price. Derived from the quotes
   * rather than passed in, so no caller can forget it.
   */
  const scheduledFor = input.quotes.find((q) => q.scheduledFor)?.scheduledFor ?? null;
  const stamp = (d: Date) =>
    d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  if (scheduledFor) {
    lines.push(
      `For departure ${stamp(new Date(scheduledFor))} · computed ${stamp(input.at)} from the published tariff, which does not move`,
    );
  } else {
    lines.push(`Checked ${stamp(input.at)} · prices move, so this is a snapshot`);
  }
  lines.push('');

  if (input.quotes.length === 0) {
    lines.push('No provider returned a price.');
  }

  for (const q of input.quotes) {
    const name = q.providerProductName || q.provider;
    lines.push(`${priceOf(q)}  ${name} (${CERTAINTY[q.priceType]})`);
  }

  if (input.unavailable.length > 0) {
    lines.push('');
    lines.push('Not available:');
    for (const u of input.unavailable) {
      lines.push(`- ${u.label}: ${u.reason}`);
    }
  }

  lines.push('');
  lines.push('Compared with RideLens. No price here is estimated on a provider’s behalf.');
  return lines.join('\n');
}
