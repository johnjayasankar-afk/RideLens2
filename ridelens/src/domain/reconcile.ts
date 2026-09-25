/**
 * Source reconciliation.
 *
 * The same provider product can arrive from more than one source — e.g. UberX
 * via the Obi aggregator and UberX via an authorized direct Uber feed. Showing
 * two UberX rows is a bug; silently picking one and hiding the disagreement is
 * a worse bug. This module picks a canonical quote deterministically and
 * records every disagreement it resolved.
 */
import type {
  NormalizedCategory,
  NormalizedQuote,
  ProviderId,
  SourceDiscrepancy,
  SourceId,
} from './quote';

/**
 * Source trust, highest first. Rationale, in order:
 *  1. A direct partner feed is the provider's own number.
 *  2. The licensed aggregator is authoritative for providers we cannot reach.
 *  3. Fixtures are non-production and must never win against real data.
 */
const SOURCE_PRECEDENCE: Readonly<Record<SourceId, number>> = {
  uber_direct: 0,
  lyft_direct: 0,
  empower_direct: 0,
  curb_flow: 0,
  obi: 1,
  /**
   * A published tariff is authoritative for the taxi it describes, but it is a
   * computation rather than a provider's own answer, so a real feed for the
   * same product outranks it.
   */
  public_rate_card: 2,
  bikeshare_gbfs: 2,
  /** Also a published table rather than a provider's own answer. */
  regional_rail: 2,
  demo_fixture: 9,
};

const PRICE_TYPE_PRECEDENCE: Readonly<Record<NormalizedQuote['priceType'], number>> = {
  UPFRONT_QUOTE: 0,
  ESTIMATE: 1,
  ESTIMATE_RANGE: 2,
  METERED_ESTIMATE: 3,
  UNKNOWN: 4,
};

const ACCOUNT_PRECEDENCE: Readonly<Record<NormalizedQuote['accountContext'], number>> = {
  ACCOUNT_LINKED: 0,
  PUBLIC: 1,
  UNKNOWN: 2,
};

/** Disagreement at or above this share of the cheaper price is worth surfacing. */
export const MATERIAL_DISCREPANCY_BPS = 1000; // 10%

/** Identity of a comparable product across sources. */
function productKey(q: NormalizedQuote): string {
  return `${q.provider}::${q.normalizedCategory}::${normalizeProductName(q.providerProductName)}`;
}

function normalizeProductName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface ReconcileResult {
  canonical: NormalizedQuote[];
  discrepancies: SourceDiscrepancy[];
}

export interface ReconcileOptions {
  now?: number;
  materialBps?: number;
}

export function reconcileQuotes(
  candidates: NormalizedQuote[],
  options: ReconcileOptions = {},
): ReconcileResult {
  const materialBps = options.materialBps ?? MATERIAL_DISCREPANCY_BPS;
  const groups = new Map<string, NormalizedQuote[]>();

  for (const q of candidates) {
    const key = productKey(q);
    const list = groups.get(key);
    if (list) list.push(q);
    else groups.set(key, [q]);
  }

  const canonical: NormalizedQuote[] = [];
  const discrepancies: SourceDiscrepancy[] = [];

  for (const group of groups.values()) {
    const sorted = [...group].sort(compareCandidates);
    const winner = sorted[0];
    if (!winner) continue;

    if (sorted.length > 1) {
      const discrepancy = describeDiscrepancy(winner, sorted.slice(1), materialBps);
      if (discrepancy) discrepancies.push(discrepancy);
    }

    canonical.push(
      sorted.length > 1
        ? {
            ...winner,
            metadata: {
              ...winner.metadata,
              reconciledFrom: sorted.map((q) => q.source).join(','),
              reconciledCandidateCount: sorted.length,
            },
          }
        : winner,
    );
  }

  return { canonical, discrepancies };
}

/**
 * Deterministic precedence. Each criterion is a hard tier — we never average
 * two sources' prices, because an average is a number no provider will honour.
 */
function compareCandidates(a: NormalizedQuote, b: NormalizedQuote): number {
  // 1. A firm upfront quote beats an estimate regardless of who sent it.
  const pt = PRICE_TYPE_PRECEDENCE[a.priceType] - PRICE_TYPE_PRECEDENCE[b.priceType];
  if (pt !== 0) return pt;

  // 2. The user's own account price beats a public market price.
  const acc = ACCOUNT_PRECEDENCE[a.accountContext] - ACCOUNT_PRECEDENCE[b.accountContext];
  if (acc !== 0) return acc;

  // 3. Bookable beats unbookable.
  const availA = a.availability === 'AVAILABLE' ? 0 : 1;
  const availB = b.availability === 'AVAILABLE' ? 0 : 1;
  if (availA !== availB) return availA - availB;

  // 4. Source authorization tier.
  const src = SOURCE_PRECEDENCE[a.source] - SOURCE_PRECEDENCE[b.source];
  if (src !== 0) return src;

  // 5. Freshness — the newer observation of the same market.
  const ta = Date.parse(a.receivedAt);
  const tb = Date.parse(b.receivedAt);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;

  // 6. A source that gave us a booking handoff is more useful.
  const hoA = a.bookingHandoff ? 0 : 1;
  const hoB = b.bookingHandoff ? 0 : 1;
  if (hoA !== hoB) return hoA - hoB;

  return a.id.localeCompare(b.id);
}

function describeDiscrepancy(
  winner: NormalizedQuote,
  losers: NormalizedQuote[],
  materialBps: number,
): SourceDiscrepancy | null {
  const comparable = losers.filter((l) => l.currency === winner.currency);
  if (comparable.length === 0) return null;

  const prices = [winner, ...comparable].map((q) => q.rankingPriceMinor);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spreadMinor = max - min;
  if (spreadMinor === 0) return null;

  const spreadBps = min > 0 ? Math.round((spreadMinor / min) * 10_000) : 0;

  return {
    provider: winner.provider as ProviderId,
    normalizedCategory: winner.normalizedCategory as NormalizedCategory,
    canonicalQuoteId: winner.id,
    conflictingQuoteIds: comparable.map((q) => q.id),
    spreadMinor,
    spreadBps,
    currency: winner.currency,
    severity: spreadBps >= materialBps ? 'MATERIAL' : 'MINOR',
  };
}

/**
 * User-facing warning for a material disagreement. Deliberately does not quote
 * the rejected number — we show the authoritative price and tell the rider to
 * confirm in the provider app, which is the only place the fare is real.
 */
export function discrepancyNotice(d: SourceDiscrepancy): string | null {
  if (d.severity !== 'MATERIAL') return null;
  return 'Price may have changed — confirm in the provider app before booking.';
}
