import type {
  ConfidenceClass,
  NormalizedQuote,
  PriceComparison,
  QuoteType,
  RankingMode,
  RideCategory,
} from "./types";
import { isStandardComparable } from "./taxonomy";

export function confidenceForQuoteType(
  type: QuoteType,
  minMinor: number,
  maxMinor: number,
): ConfidenceClass {
  if (type === "UPFRONT_QUOTE" && minMinor === maxMinor) return "HIGH";
  if (type === "ESTIMATE" && minMinor === maxMinor) return "MEDIUM";
  const width = maxMinor - minMinor;
  const mid = (minMinor + maxMinor) / 2 || 1;
  const pct = width / mid;
  if (type === "ESTIMATE_RANGE") {
    if (pct <= 0.15) return "MEDIUM";
    if (pct <= 0.35) return "LOW";
    return "UNCERTAIN";
  }
  if (type === "METERED_ESTIMATE") return "LOW";
  return "UNCERTAIN";
}

function overlapRatio(aMin: number, aMax: number, bMin: number, bMax: number): number {
  const overlap = Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
  const smaller = Math.min(aMax - aMin, bMax - bMin) || 1;
  return overlap / smaller;
}

/**
 * Uncertainty-aware price comparison.
 * Exact $25 vs $21–29 must NOT assert B is cheaper.
 */
export function comparePrices(
  a: Pick<
    NormalizedQuote,
    | "priceMinMinor"
    | "priceMaxMinor"
    | "rankingPriceMinor"
    | "priceType"
    | "confidenceClass"
  >,
  b: Pick<
    NormalizedQuote,
    | "priceMinMinor"
    | "priceMaxMinor"
    | "rankingPriceMinor"
    | "priceType"
    | "confidenceClass"
  >,
): PriceComparison {
  // Non-overlapping: a entirely below b
  if (a.priceMaxMinor < b.priceMinMinor) {
    return {
      relation: "cheaper",
      savingsMinor: b.priceMinMinor - a.priceMaxMinor,
      label: "Cheaper",
    };
  }
  if (b.priceMaxMinor < a.priceMinMinor) {
    return {
      relation: "more_expensive",
      savingsMinor: a.priceMinMinor - b.priceMaxMinor,
      label: "More expensive",
    };
  }

  const overlap = overlapRatio(
    a.priceMinMinor,
    a.priceMaxMinor,
    b.priceMinMinor,
    b.priceMaxMinor,
  );

  const bothHigh =
    a.confidenceClass === "HIGH" &&
    b.confidenceClass === "HIGH" &&
    a.priceMinMinor === a.priceMaxMinor &&
    b.priceMinMinor === b.priceMaxMinor;

  if (bothHigh) {
    const delta = b.priceMinMinor - a.priceMinMinor;
    if (delta > 0)
      return { relation: "cheaper", savingsMinor: delta, label: "Cheaper" };
    if (delta < 0)
      return {
        relation: "more_expensive",
        savingsMinor: -delta,
        label: "More expensive",
      };
    return { relation: "similar", savingsMinor: 0, label: "Similar price" };
  }

  if (overlap >= 0.5) {
    return { relation: "similar", label: "Similar price" };
  }

  // Partial overlap — use ranking midpoints cautiously
  const delta = b.rankingPriceMinor - a.rankingPriceMinor;
  if (Math.abs(delta) < 200) {
    return { relation: "similar", label: "Similar price" };
  }
  if (delta > 0) {
    return {
      relation: "unclear",
      savingsMinor: delta,
      label: "Likely cheaper",
    };
  }
  return {
    relation: "unclear",
    savingsMinor: -delta,
    label: "Price uncertain",
  };
}

function confidenceRank(c: ConfidenceClass): number {
  switch (c) {
    case "HIGH":
      return 0;
    case "MEDIUM":
      return 1;
    case "LOW":
      return 2;
    default:
      return 3;
  }
}

export function filterByCategories(
  quotes: NormalizedQuote[],
  filter: RideCategory[] | "ALL" | "standard",
): NormalizedQuote[] {
  const available = quotes.filter(
    (q) => q.availability !== "UNAVAILABLE" && q.freshness !== "EXPIRED",
  );
  if (filter === "ALL") return available;
  if (filter === "standard") {
    return available.filter((q) => isStandardComparable(q.normalizedCategory));
  }
  return available.filter((q) => filter.includes(q.normalizedCategory));
}

export function rankQuotes(
  quotes: NormalizedQuote[],
  mode: RankingMode = "cheapest",
  filter: RideCategory[] | "ALL" | "standard" = "standard",
): NormalizedQuote[] {
  const list = [...filterByCategories(quotes, filter)];

  list.sort((a, b) => {
    if (mode === "fastest") {
      const ae = a.pickupEtaSeconds ?? Number.POSITIVE_INFINITY;
      const be = b.pickupEtaSeconds ?? Number.POSITIVE_INFINITY;
      if (ae !== be) return ae - be;
      return a.rankingPriceMinor - b.rankingPriceMinor;
    }

    if (mode === "best_value") {
      // Interpretable: price + ETA penalty ($0.10/min pickup)
      const score = (q: NormalizedQuote) => {
        const etaMin = (q.pickupEtaSeconds ?? 600) / 60;
        return q.rankingPriceMinor + Math.round(etaMin * 10);
      };
      const d = score(a) - score(b);
      if (d !== 0) return d;
    }

    // cheapest (default) — uncertainty-aware secondary keys
    const cmp = comparePrices(a, b);
    if (cmp.relation === "cheaper") return -1;
    if (cmp.relation === "more_expensive") return 1;

    if (a.rankingPriceMinor !== b.rankingPriceMinor) {
      return a.rankingPriceMinor - b.rankingPriceMinor;
    }
    const conf = confidenceRank(a.confidenceClass) - confidenceRank(b.confidenceClass);
    if (conf !== 0) return conf;
    const ae = a.pickupEtaSeconds ?? Number.POSITIVE_INFINITY;
    const be = b.pickupEtaSeconds ?? Number.POSITIVE_INFINITY;
    return ae - be;
  });

  return list;
}

export function pickHero(ranked: NormalizedQuote[]): NormalizedQuote | null {
  return ranked[0] ?? null;
}
