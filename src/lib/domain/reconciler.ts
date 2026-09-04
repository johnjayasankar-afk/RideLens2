import type {
  Discrepancy,
  NormalizedQuote,
  ProviderId,
  QuoteType,
  RideCategory,
} from "./types";

const SOURCE_QUALITY: Record<string, number> = {
  obi: 100,
  lyft_authorized: 80,
  curb_flow: 75,
  empower_authorized: 70,
  uber_authorized: 40, // intentionally low — comparison restricted
  fixture: 10,
};

function quoteTypeScore(t: QuoteType): number {
  switch (t) {
    case "UPFRONT_QUOTE":
      return 50;
    case "ESTIMATE":
      return 30;
    case "ESTIMATE_RANGE":
      return 25;
    case "METERED_ESTIMATE":
      return 15;
    default:
      return 0;
  }
}

function accountScore(q: NormalizedQuote): number {
  return q.accountContext === "ACCOUNT_LINKED" ? 20 : 0;
}

function freshnessScore(q: NormalizedQuote): number {
  switch (q.freshness) {
    case "LIVE":
      return 15;
    case "RECENT":
      return 10;
    case "STALE":
      return 3;
    default:
      return -50;
  }
}

export function scoreCandidate(q: NormalizedQuote): number {
  const src = SOURCE_QUALITY[q.source] ?? 5;
  return (
    src +
    quoteTypeScore(q.priceType) +
    accountScore(q) +
    freshnessScore(q)
  );
}

function productKey(q: NormalizedQuote): string {
  const name = q.providerProductName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${q.provider}:${q.normalizedCategory}:${name}`;
}

function materialDelta(a: NormalizedQuote, b: NormalizedQuote): number {
  return Math.abs(a.rankingPriceMinor - b.rankingPriceMinor);
}

function isMaterial(a: NormalizedQuote, b: NormalizedQuote): boolean {
  const delta = materialDelta(a, b);
  const base = Math.max(a.rankingPriceMinor, b.rankingPriceMinor, 1);
  return delta >= 300 || delta / base >= 0.15;
}

export interface ReconcileResult {
  visible: NormalizedQuote[];
  discrepancies: Discrepancy[];
  allCandidates: NormalizedQuote[];
}

export function reconcileQuotes(
  candidates: NormalizedQuote[],
): ReconcileResult {
  const groups = new Map<string, NormalizedQuote[]>();
  for (const q of candidates) {
    const key = productKey(q);
    const list = groups.get(key) ?? [];
    list.push(q);
    groups.set(key, list);
  }

  const visible: NormalizedQuote[] = [];
  const discrepancies: Discrepancy[] = [];

  for (const [, group] of groups) {
    const sorted = [...group].sort(
      (a, b) => scoreCandidate(b) - scoreCandidate(a),
    );
    const winner = sorted[0]!;
    visible.push(winner);

    if (sorted.length > 1) {
      const others = sorted.slice(1);
      const material = others.filter((o) => isMaterial(winner, o));
      if (material.length > 0) {
        const worst = material.reduce((acc, o) =>
          materialDelta(winner, o) > materialDelta(winner, acc) ? o : acc,
        );
        discrepancies.push({
          provider: winner.provider as ProviderId,
          category: winner.normalizedCategory as RideCategory,
          quotes: [winner, ...material],
          deltaMinor: materialDelta(winner, worst),
          message: `Price may have changed — confirm in ${winner.provider}. Sources disagree by $${(materialDelta(winner, worst) / 100).toFixed(2)}.`,
        });
      }
    }
  }

  return { visible, discrepancies, allCandidates: candidates };
}
