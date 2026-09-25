import type { Discrepancy, NormalizedQuote, ProviderId, QuoteType, RideCategory } from "./types";

/**
 * How much a source's number is worth when two of them disagree.
 *
 * public_rate_card was absent and fell through to the unknown-source
 * fallback of 5 — below fixture's 10. The one source enabled by default
 * ranked last, so wherever fixtures are on, fake data outranked the real
 * modeled quote for the same product. It sits above fixture and below every
 * real partner feed, which is what a modeled estimate from a published
 * tariff is worth: more than an invention, less than an answer from the
 * marketplace itself.
 */
const SOURCE_QUALITY: Record<string, number> = {
  obi: 100,
  lyft_authorized: 80,
  curb_flow: 75,
  empower_authorized: 70,
  uber_authorized: 40, // intentionally low — comparison restricted
  public_rate_card: 20,
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
  return src + quoteTypeScore(q.priceType) + accountScore(q) + freshnessScore(q);
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

/**
 * Expiry is a gate, not a penalty.
 *
 * EXPIRED scores -50, which sounds decisive until a source bonus of 100
 * absorbs it: an expired Obi quote scored 75 and beat a live modeled one at
 * 60. That would be merely wrong if the winner were shown — but reconcile
 * runs before rank, and rank drops EXPIRED. The expired quote won its group,
 * the live sibling was discarded in reconciliation, and then the winner was
 * filtered out too. The rider lost the whole ride option and saw no reason
 * for it.
 *
 * A price nobody is holding any more cannot outrank one somebody is, at any
 * pedigree. Among two expired quotes, or two live ones, score decides as
 * before.
 */
function preferLiveThenScore(a: NormalizedQuote, b: NormalizedQuote): number {
  const aDead = a.freshness === "EXPIRED";
  const bDead = b.freshness === "EXPIRED";
  if (aDead !== bDead) return aDead ? 1 : -1;
  return scoreCandidate(b) - scoreCandidate(a);
}

export interface ReconcileResult {
  visible: NormalizedQuote[];
  discrepancies: Discrepancy[];
  allCandidates: NormalizedQuote[];
}

export function reconcileQuotes(candidates: NormalizedQuote[]): ReconcileResult {
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
    const sorted = [...group].sort(preferLiveThenScore);
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
          message: `Price may have changed: confirm in ${winner.provider}. Sources disagree by $${(materialDelta(winner, worst) / 100).toFixed(2)}.`,
        });
      }
    }
  }

  return { visible, discrepancies, allCandidates: candidates };
}
