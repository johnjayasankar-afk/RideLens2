/**
 * Confidence, and how it dies.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A modeled estimate is computed against marketplace conditions at one     │
 * │ instant. The simulation ticks on ~55 seconds; demand, weather and the    │
 * │ direction of travel all move. Four minutes later the number on screen is │
 * │ an answer to a question about a moment that has passed — and until now   │
 * │ the product presented it exactly as it presented a fresh one.            │
 * │                                                                          │
 * │ Freshness already says *how old* a quote is. It does not say what age    │
 * │ costs you. This does.                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── What does not decay ────────────────────────────────────────────────────
 *
 * A partner's upfront quote inside its own validity window is not a guess
 * that goes stale — it is a price the provider is holding. Age tells you
 * nothing about it until it expires, at which point it is EXPIRED and already
 * filtered from the list. Decaying it would be a different lie: understating a
 * number that is, for now, contractual.
 *
 * So decay applies to the modeled and estimated cases, and the distinction is
 * the point rather than an exception.
 *
 * ── Why this does not touch ranking ────────────────────────────────────────
 *
 * Every quote in a comparison is fetched together and ages together, so decay
 * moves them all by the same amount and the order almost never changes. What
 * it *would* reliably do is make `rankQuotes` a function of wall-clock time,
 * and a list that silently re-sorts while a rider is reading it is a worse
 * failure than the tiebreak it would fix. Decay changes what we say about a
 * number, not where it sits.
 */

import { FRESHNESS_THRESHOLDS, computeFreshness } from "./freshness";
import type { ConfidenceClass, Freshness, NormalizedQuote } from "./types";

/** Weakest to strongest, so a step down is an index move. */
const LADDER: readonly ConfidenceClass[] = ["UNCERTAIN", "LOW", "MEDIUM", "HIGH"] as const;

/**
 * How many classes a quote of this age has dropped.
 *
 * Deliberately reuses FRESHNESS_THRESHOLDS rather than introducing a second,
 * competing notion of "old". If those thresholds are wrong, they are wrong in
 * one place.
 */
export function decaySteps(freshness: Freshness): number {
  switch (freshness) {
    case "LIVE":
      return 0;
    case "RECENT":
      return 1;
    case "STALE":
      return 2;
    case "EXPIRED":
      return 3;
    default:
      return 1;
  }
}

export function stepDown(c: ConfidenceClass, steps: number): ConfidenceClass {
  const i = LADDER.indexOf(c);
  if (i < 0) return "UNCERTAIN";
  return LADDER[Math.max(0, i - Math.max(0, steps))]!;
}

/**
 * Whether age tells you anything about this quote.
 *
 * True for anything modeled or estimated. False only while a provider is
 * actually holding the price.
 */
export function decaysWithAge(
  quote: Pick<NormalizedQuote, "priceType" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (quote.priceType !== "UPFRONT_QUOTE") return true;
  if (!quote.expiresAt) return true;
  const expires = new Date(quote.expiresAt).getTime();
  if (!Number.isFinite(expires)) return true;
  return now.getTime() >= expires;
}

export interface DecayedConfidence {
  /** What to show now. */
  class: ConfidenceClass;
  /** What the source said when the quote was made. */
  base: ConfidenceClass;
  /** Classes dropped. 0 when fresh or when the price is being held. */
  steps: number;
  /** Whether age is relevant to this quote at all. */
  decays: boolean;
  /** Rider-readable cause, or null when nothing has changed. */
  reason: string | null;
}

/**
 * The confidence to show for a quote right now.
 *
 * Pure in `now`, so callers thread their own clock and rendering stays
 * predictable.
 */
export function decayedConfidence(
  quote: Pick<
    NormalizedQuote,
    "priceType" | "expiresAt" | "receivedAt" | "confidenceClass" | "freshness"
  >,
  now: Date = new Date(),
): DecayedConfidence {
  const base = quote.confidenceClass;

  if (!decaysWithAge(quote, now)) {
    return {
      class: base,
      base,
      steps: 0,
      decays: false,
      reason: null,
    };
  }

  const freshness = computeFreshness(quote.receivedAt, quote.expiresAt, now);
  const steps = decaySteps(freshness);
  const next = stepDown(base, steps);

  if (steps === 0 || next === base) {
    return { class: next, base, steps, decays: true, reason: null };
  }

  return {
    class: next,
    base,
    steps,
    decays: true,
    reason: reasonFor(freshness),
  };
}

function reasonFor(freshness: Freshness): string {
  switch (freshness) {
    case "RECENT":
      return "Conditions have moved on since this was estimated.";
    case "STALE":
      return "This was estimated several minutes ago, against conditions that have since changed.";
    case "EXPIRED":
      return "Too old to stand behind. Refresh before you book.";
    default:
      return "Conditions have moved on since this was estimated.";
  }
}

/**
 * The rider-facing name for a class.
 *
 * No percentage. A percentage implies a measured frequency, and until
 * docs/CALIBRATION.md has a coverage figure there is nothing to measure it
 * against — see src/lib/eval/metrics.ts.
 */
export function confidenceLabel(c: ConfidenceClass): string {
  switch (c) {
    case "HIGH":
      return "High confidence";
    case "MEDIUM":
      return "Solid estimate";
    case "LOW":
      return "Rough estimate";
    default:
      return "Wide open";
  }
}

/** Position on the ladder, 1–4. For a stepped indicator, never a bar. */
export function confidenceStep(c: ConfidenceClass): number {
  const i = LADDER.indexOf(c);
  return i < 0 ? 1 : i + 1;
}

export const CONFIDENCE_STEPS = LADDER.length;

/**
 * Seconds until this quote's confidence drops a class, or null if it will not.
 *
 * Lets the UI warn before the number gets worse rather than after.
 */
export function secondsToNextDecay(
  quote: Pick<
    NormalizedQuote,
    "priceType" | "expiresAt" | "receivedAt" | "confidenceClass" | "freshness"
  >,
  now: Date = new Date(),
): number | null {
  if (!decaysWithAge(quote, now)) return null;
  const current = decayedConfidence(quote, now);
  if (current.class === "UNCERTAIN") return null;

  const received = new Date(quote.receivedAt).getTime();
  if (!Number.isFinite(received)) return null;
  const ageMs = now.getTime() - received;

  const next = [
    FRESHNESS_THRESHOLDS.liveMs,
    FRESHNESS_THRESHOLDS.recentMs,
    FRESHNESS_THRESHOLDS.staleMs,
  ].find((t) => ageMs <= t);
  if (next == null) return null;
  return Math.max(0, Math.ceil((next - ageMs) / 1000));
}
