import { describe, expect, it } from 'vitest';
import {
  applyFilter,
  fastestPickup,
  groupByCategory,
  isBookable,
  rankQuotes,
  valueScore,
  WAIT_COST_MINOR_PER_MIN,
} from '@/domain/ranking';
import { makeQuote } from '@tests/helpers';

describe('isBookable', () => {
  it('excludes expired, unavailable and unpriced options', () => {
    expect(isBookable(makeQuote())).toBe(true);
    expect(isBookable(makeQuote({ freshness: 'EXPIRED' }))).toBe(false);
    expect(isBookable(makeQuote({ availability: 'UNAVAILABLE' }))).toBe(false);
    expect(isBookable(makeQuote({ priceType: 'UNKNOWN' }))).toBe(false);
  });
});

describe('rankQuotes CHEAPEST', () => {
  it('orders by price when the prices are clearly separated', () => {
    const ranked = rankQuotes([
      makeQuote({ id: 'c', provider: 'uber', minMinor: 3296 }),
      makeQuote({ id: 'a', provider: 'empower', minMinor: 2384 }),
      makeQuote({ id: 'b', provider: 'curb', minMinor: 2720 }),
    ]);
    expect(ranked.map((q) => q.id)).toEqual(['a', 'b', 'c']);
  });

  it('prefers the firmer promise when two prices are statistically similar', () => {
    const range = makeQuote({
      id: 'range',
      provider: 'lyft',
      minMinor: 2400,
      maxMinor: 3200,
      priceType: 'ESTIMATE_RANGE',
      confidence: 'LOW',
    });
    const upfront = makeQuote({
      id: 'upfront',
      provider: 'curb',
      minMinor: 2800,
      maxMinor: 2800,
      priceType: 'UPFRONT_QUOTE',
      confidence: 'HIGH',
    });
    // The range's low end is lower, but the two overlap heavily; the firm
    // quote wins the tie rather than the optimistic band.
    expect(rankQuotes([range, upfront])[0]?.id).toBe('upfront');
  });

  it('sinks unavailable and expired options below every bookable one', () => {
    const ranked = rankQuotes([
      makeQuote({ id: 'cheap-gone', minMinor: 1000, availability: 'UNAVAILABLE' }),
      makeQuote({ id: 'expensive-ok', minMinor: 5000, provider: 'lyft' }),
      makeQuote({ id: 'cheap-expired', minMinor: 1200, provider: 'curb', freshness: 'EXPIRED' }),
    ]);
    expect(ranked[0]?.id).toBe('expensive-ok');
  });

  it('is deterministic for identical inputs', () => {
    const input = [
      makeQuote({ id: 'a', provider: 'uber', minMinor: 2500 }),
      makeQuote({ id: 'b', provider: 'lyft', minMinor: 2500 }),
      makeQuote({ id: 'c', provider: 'curb', minMinor: 2500 }),
    ];
    expect(rankQuotes(input).map((q) => q.id)).toEqual(
      rankQuotes([...input].reverse()).map((q) => q.id),
    );
  });

  it('never numerically compares two currencies', () => {
    const usd = makeQuote({ id: 'usd', currency: 'USD', minMinor: 5000 });
    const gbp = makeQuote({ id: 'gbp', currency: 'GBP', minMinor: 1000, provider: 'lyft' });
    const ranked = rankQuotes([usd, gbp]);
    // Ordered by currency code, not by the meaningless 1000 < 5000.
    expect(ranked[0]?.currency).toBe('GBP');
  });
});

describe('rankQuotes FASTEST', () => {
  it('orders by pickup ETA and pushes unknown ETAs last', () => {
    const ranked = rankQuotes(
      [
        makeQuote({ id: 'slow', eta: 600, minMinor: 1000 }),
        makeQuote({ id: 'fast', eta: 120, minMinor: 9000, provider: 'lyft' }),
        makeQuote({ id: 'unknown', eta: null, minMinor: 500, provider: 'curb' }),
      ],
      'FASTEST',
    );
    expect(ranked.map((q) => q.id)).toEqual(['fast', 'slow', 'unknown']);
  });
});

describe('rankQuotes BEST_VALUE', () => {
  it('prices waiting time transparently', () => {
    const q = makeQuote({ minMinor: 2000, maxMinor: 2000, eta: 600 });
    expect(valueScore(q)).toBe(2000 + 10 * WAIT_COST_MINOR_PER_MIN);
  });

  it('can prefer a slightly dearer ride that arrives much sooner', () => {
    const cheapSlow = makeQuote({ id: 'cheap-slow', minMinor: 2000, maxMinor: 2000, eta: 1200 });
    const dearFast = makeQuote({
      id: 'dear-fast',
      provider: 'lyft',
      minMinor: 2300,
      maxMinor: 2300,
      eta: 120,
    });
    expect(rankQuotes([cheapSlow, dearFast], 'BEST_VALUE')[0]?.id).toBe('dear-fast');
  });
});

describe('applyFilter', () => {
  const quotes = [
    makeQuote({ id: 'std', category: 'STANDARD' }),
    makeQuote({ id: 'taxi', category: 'TAXI', provider: 'curb' }),
    makeQuote({ id: 'xl', category: 'XL', provider: 'lyft' }),
    makeQuote({ id: 'lux', category: 'LUXURY', provider: 'uber', productId: 'black' }),
    makeQuote({ id: 'ev', category: 'EV', provider: 'uber', productId: 'green' }),
  ];

  it('BEST covers standard-equivalent supply plus taxi, excluding XL and luxury', () => {
    const ids = applyFilter(quotes, 'BEST').map((q) => q.id);
    expect(ids).toContain('std');
    expect(ids).toContain('taxi');
    expect(ids).not.toContain('xl');
    expect(ids).not.toContain('lux');
  });

  it('PREMIUM groups premium and luxury together', () => {
    expect(applyFilter(quotes, 'PREMIUM').map((q) => q.id)).toEqual(['lux']);
  });

  it('ALL passes everything through', () => {
    expect(applyFilter(quotes, 'ALL')).toHaveLength(5);
  });
});

describe('fastestPickup', () => {
  it('ignores options that cannot actually be booked', () => {
    const result = fastestPickup([
      makeQuote({ id: 'gone', eta: 60, availability: 'UNAVAILABLE' }),
      makeQuote({ id: 'real', eta: 180, provider: 'lyft' }),
    ]);
    expect(result?.id).toBe('real');
  });
});

describe('groupByCategory', () => {
  it('presents standard supply before XL and luxury', () => {
    const groups = groupByCategory([
      makeQuote({ category: 'LUXURY', id: 'l' }),
      makeQuote({ category: 'STANDARD', id: 's' }),
      makeQuote({ category: 'XL', id: 'x' }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['STANDARD', 'XL', 'LUXURY']);
  });
});
