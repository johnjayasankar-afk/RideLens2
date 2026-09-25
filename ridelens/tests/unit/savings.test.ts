import { describe, expect, it } from 'vitest';
import { pickBaseline, savingsFor } from '@/domain/savings';
import { makeQuote } from '@tests/helpers';

const empower = makeQuote({
  id: 'empower',
  provider: 'empower',
  productId: 'everyday',
  productName: 'Everyday',
  minMinor: 2384,
  maxMinor: 2384,
  rankingMinor: 2384,
});
const uberx = makeQuote({
  id: 'uberx',
  provider: 'uber',
  productId: 'uberx',
  productName: 'UberX',
  minMinor: 3296,
  maxMinor: 3296,
  rankingMinor: 3296,
});
const curb = makeQuote({
  id: 'curb',
  provider: 'curb',
  productId: 'taxi',
  productName: 'Curb Taxi',
  category: 'TAXI',
  minMinor: 2720,
  maxMinor: 2720,
  rankingMinor: 2720,
});

describe('pickBaseline', () => {
  it('prefers the most recognisable comparable provider', () => {
    expect(pickBaseline(empower, [empower, uberx, curb])?.id).toBe('uberx');
  });

  it('honours an explicit baseline choice', () => {
    expect(pickBaseline(empower, [empower, uberx, curb], 'curb')?.id).toBe('curb');
  });

  it('never uses an unbookable option as a baseline', () => {
    const gone = makeQuote({ id: 'gone', provider: 'uber', availability: 'UNAVAILABLE' });
    expect(pickBaseline(empower, [empower, gone])).toBeNull();
  });

  it('never crosses currencies', () => {
    const gbp = makeQuote({ id: 'gbp', provider: 'uber', currency: 'GBP' });
    expect(pickBaseline(empower, [empower, gbp])).toBeNull();
  });
});

describe('savingsFor', () => {
  it('states an exact integer saving', () => {
    const line = savingsFor(empower, [empower, uberx, curb]);
    expect(line.text).toBe('Save $9.12 vs UberX');
    expect(line.deltaMinor).toBe(-912);
  });

  it('states a premium plainly rather than hiding it', () => {
    expect(savingsFor(uberx, [empower, uberx]).text).toBe('+$9.12 vs Everyday');
  });

  it('says "similar price" instead of asserting a saving that is not real', () => {
    const a = makeQuote({
      id: 'a',
      provider: 'empower',
      productName: 'Everyday',
      rankingMinor: 2500,
      minMinor: 2500,
      maxMinor: 2500,
    });
    const b = makeQuote({
      id: 'b',
      provider: 'uber',
      productName: 'UberX',
      rankingMinor: 2540,
      minMinor: 2540,
      maxMinor: 2540,
    });
    const line = savingsFor(a, [a, b]);
    expect(line.similar).toBe(true);
    expect(line.text).toBe('Similar price to UberX');
  });

  it('hedges when the cheaper claim rests on an uncertain range', () => {
    const wide = makeQuote({
      id: 'wide',
      provider: 'empower',
      productName: 'Everyday',
      priceType: 'ESTIMATE_RANGE',
      minMinor: 1800,
      maxMinor: 2600,
      rankingMinor: 2200,
      confidence: 'LOW',
    });
    const firm = makeQuote({
      id: 'firm',
      provider: 'uber',
      productName: 'UberX',
      priceType: 'UPFRONT_QUOTE',
      minMinor: 2900,
      maxMinor: 2900,
      rankingMinor: 2900,
      confidence: 'HIGH',
    });
    expect(savingsFor(wide, [wide, firm]).text).toMatch(/^Likely saves about \$7\.00 vs UberX$/);
  });

  it('returns no claim when there is nothing to compare against', () => {
    expect(savingsFor(empower, [empower]).text).toBeNull();
  });
});
