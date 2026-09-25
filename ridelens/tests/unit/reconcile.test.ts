import { describe, expect, it } from 'vitest';
import { discrepancyNotice, MATERIAL_DISCREPANCY_BPS, reconcileQuotes } from '@/domain/reconcile';
import { makeQuote } from '@tests/helpers';

const T = Date.parse('2026-09-03T18:00:00.000Z');
const at = (ms: number) => new Date(T + ms).toISOString();

describe('reconcileQuotes', () => {
  it('collapses the same product from two sources into one row', () => {
    const viaObi = makeQuote({
      id: 'obi-uberx',
      source: 'obi',
      productName: 'UberX',
      minMinor: 3200,
      maxMinor: 3200,
    });
    const viaDirect = makeQuote({
      id: 'direct-uberx',
      source: 'uber_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      productName: 'UberX',
      minMinor: 3100,
      maxMinor: 3100,
    });
    const { canonical } = reconcileQuotes([viaObi, viaDirect]);
    expect(canonical).toHaveLength(1);
    // Never two UberX rows.
    expect(canonical.filter((q) => q.providerProductName === 'UberX')).toHaveLength(1);
  });

  it('prefers a direct partner feed over the aggregator, all else equal', () => {
    const viaObi = makeQuote({
      id: 'obi-uberx',
      source: 'obi',
      minMinor: 3200,
      maxMinor: 3200,
      receivedAt: at(0),
    });
    const viaDirect = makeQuote({
      id: 'direct-uberx',
      source: 'uber_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      minMinor: 3100,
      maxMinor: 3100,
      receivedAt: at(0),
    });
    expect(reconcileQuotes([viaObi, viaDirect]).canonical[0]?.id).toBe('direct-uberx');
  });

  it('lets an upfront quote beat an estimate regardless of which source sent it', () => {
    const estimateDirect = makeQuote({
      id: 'direct-est',
      source: 'uber_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      priceType: 'ESTIMATE_RANGE',
      minMinor: 3800,
      maxMinor: 4100,
    });
    const upfrontAggregated = makeQuote({
      id: 'obi-upfront',
      source: 'obi',
      priceType: 'UPFRONT_QUOTE',
      minMinor: 3120,
      maxMinor: 3120,
    });
    expect(reconcileQuotes([estimateDirect, upfrontAggregated]).canonical[0]?.id).toBe(
      'obi-upfront',
    );
  });

  it('lets an account-linked price beat a public one', () => {
    const pub = makeQuote({ id: 'public', source: 'obi', accountContext: 'PUBLIC' });
    const linked = makeQuote({
      id: 'linked',
      source: 'obi',
      accountContext: 'ACCOUNT_LINKED',
      minMinor: 2900,
      maxMinor: 2900,
    });
    expect(reconcileQuotes([pub, linked]).canonical[0]?.id).toBe('linked');
  });

  it('breaks a same-tier tie by freshness', () => {
    const older = makeQuote({ id: 'older', source: 'obi', receivedAt: at(0) });
    const newer = makeQuote({ id: 'newer', source: 'obi', receivedAt: at(5_000) });
    expect(reconcileQuotes([older, newer]).canonical[0]?.id).toBe('newer');
  });

  it('is deterministic regardless of arrival order', () => {
    const a = makeQuote({ id: 'a', source: 'obi', receivedAt: at(0) });
    const b = makeQuote({
      id: 'b',
      source: 'uber_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      receivedAt: at(0),
    });
    expect(reconcileQuotes([a, b]).canonical[0]?.id).toBe(reconcileQuotes([b, a]).canonical[0]?.id);
  });

  it('records the disagreement rather than silently discarding it', () => {
    // Obi says $31.20, direct authorized Uber says $38-41.
    const obi = makeQuote({
      id: 'obi',
      source: 'obi',
      priceType: 'ESTIMATE',
      minMinor: 3120,
      maxMinor: 3120,
      rankingMinor: 3120,
    });
    const direct = makeQuote({
      id: 'direct',
      source: 'uber_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      priceType: 'ESTIMATE_RANGE',
      minMinor: 3800,
      maxMinor: 4100,
      rankingMinor: 3950,
    });
    const { canonical, discrepancies } = reconcileQuotes([obi, direct]);

    // Obi's point estimate outranks the direct range on price type.
    expect(canonical[0]?.id).toBe('obi');
    expect(discrepancies).toHaveLength(1);
    const d = discrepancies[0];
    expect(d?.spreadMinor).toBe(830);
    expect(d?.spreadBps).toBeGreaterThanOrEqual(MATERIAL_DISCREPANCY_BPS);
    expect(d?.severity).toBe('MATERIAL');
    expect(d?.conflictingQuoteIds).toEqual(['direct']);
  });

  it('classifies a small disagreement as minor and shows no warning', () => {
    const a = makeQuote({
      id: 'a',
      source: 'obi',
      minMinor: 3200,
      maxMinor: 3200,
      rankingMinor: 3200,
    });
    const b = makeQuote({
      id: 'b',
      source: 'uber_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      minMinor: 3100,
      maxMinor: 3100,
      rankingMinor: 3100,
    });
    const { discrepancies } = reconcileQuotes([a, b]);
    expect(discrepancies[0]?.severity).toBe('MINOR');
    expect(discrepancyNotice(discrepancies[0]!)).toBeNull();
  });

  it('surfaces a confirm-in-app warning for a material disagreement', () => {
    const d = reconcileQuotes([
      makeQuote({ id: 'a', source: 'obi', minMinor: 2000, maxMinor: 2000, rankingMinor: 2000 }),
      makeQuote({
        id: 'b',
        source: 'uber_direct',
        sourceMethod: 'DIRECT_PARTNER_API',
        minMinor: 4000,
        maxMinor: 4000,
        rankingMinor: 4000,
      }),
    ]).discrepancies[0];
    expect(discrepancyNotice(d!)).toMatch(/confirm in the provider app/i);
  });

  it('never averages two disagreeing sources into a price nobody quoted', () => {
    const { canonical } = reconcileQuotes([
      makeQuote({ id: 'a', source: 'obi', minMinor: 3000, maxMinor: 3000, rankingMinor: 3000 }),
      makeQuote({
        id: 'b',
        source: 'uber_direct',
        sourceMethod: 'DIRECT_PARTNER_API',
        minMinor: 4000,
        maxMinor: 4000,
        rankingMinor: 4000,
      }),
    ]);
    expect([3000, 4000]).toContain(canonical[0]?.rankingPriceMinor);
    expect(canonical[0]?.rankingPriceMinor).not.toBe(3500);
  });

  it('keeps genuinely different products apart', () => {
    const { canonical } = reconcileQuotes([
      makeQuote({ id: 'x', productId: 'uberx', productName: 'UberX', category: 'STANDARD' }),
      makeQuote({ id: 'xl', productId: 'uberxl', productName: 'UberXL', category: 'XL' }),
    ]);
    expect(canonical).toHaveLength(2);
  });

  it('ranks fixture data below every real source', () => {
    const fixture = makeQuote({ id: 'fx', source: 'demo_fixture', sourceMethod: 'LOCAL_FIXTURE' });
    const real = makeQuote({ id: 'real', source: 'obi' });
    expect(reconcileQuotes([fixture, real]).canonical[0]?.id).toBe('real');
  });

  it('does not report a discrepancy across different currencies', () => {
    const usd = makeQuote({ id: 'usd', source: 'obi', currency: 'USD', rankingMinor: 3000 });
    const gbp = makeQuote({
      id: 'gbp',
      source: 'uber_direct',
      sourceMethod: 'DIRECT_PARTNER_API',
      currency: 'GBP',
      rankingMinor: 2000,
    });
    expect(reconcileQuotes([usd, gbp]).discrepancies).toHaveLength(0);
  });
});
