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

  const recognizable = rest.find((q) =>
    RECOGNIZABLE.includes(q.provider) && q.provider !== best.provider,
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
