import { formatMoneyMinor } from "./money";
import { comparePrices } from "./ranking";
import type { NormalizedQuote, ProviderId } from "./types";

const RECOGNIZABLE: ProviderId[] = ["uber", "lyft", "curb", "empower"];

export function defaultBaseline(
  best: NormalizedQuote,
  ranked: NormalizedQuote[],
): NormalizedQuote | null {
  const rest = ranked.filter((q) => q.id !== best.id);
  if (rest.length === 0) return null;

  const recognizable = rest.find(
    (q) => RECOGNIZABLE.includes(q.provider) && q.provider !== best.provider,
  );
  return recognizable ?? rest[0] ?? null;
}

export function computeSavings(
  best: NormalizedQuote,
  baseline: NormalizedQuote | null,
): { text: string; savingsMinor: number } | null {
  if (!baseline) return null;
  const cmp = comparePrices(best, baseline);
  if (cmp.relation !== "cheaper" && cmp.relation !== "unclear") return null;
  if (!cmp.savingsMinor || cmp.savingsMinor <= 0) return null;

  // Only assert firm savings when comparison is clear
  if (cmp.relation === "unclear") {
    return {
      savingsMinor: cmp.savingsMinor,
      text: `Likely save ~${formatMoneyMinor(cmp.savingsMinor)} vs ${baseline.providerProductName}`,
    };
  }

  const name =
    baseline.provider === "uber"
      ? baseline.providerProductName
      : baseline.provider.charAt(0).toUpperCase() + baseline.provider.slice(1);

  return {
    savingsMinor: cmp.savingsMinor,
    text: `Save ${formatMoneyMinor(cmp.savingsMinor)} vs ${name}`,
  };
}

/**
 * Join sentences that were written separately.
 *
 * The savings line is a fragment by design — "Save $28.20 vs UberX" — because
 * it is also used on its own. Joined to a following sentence with a bare
 * space it produced "Save $28.20 vs UberX Weather is lifting estimated
 * prices.", which reads as one broken sentence rather than two good ones.
 *
 * Each part is terminated before it is joined. Empty parts are dropped, so a
 * caller can build a list conditionally without guarding every push.
 */
export function joinSentences(parts: readonly string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/[.!?…]$/.test(p) ? p : `${p}.`))
    .join(" ");
}
