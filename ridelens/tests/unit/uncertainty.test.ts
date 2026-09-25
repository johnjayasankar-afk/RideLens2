/**
 * The core product-truth tests.
 *
 * An exact $25 upfront fare and a $20–40 estimate must not produce the claim
 * "the $20 ride is cheaper". These tests pin that behaviour.
 */
import { describe, expect, it } from 'vitest';
import {
  compareWithUncertainty,
  confidenceFor,
  headlineFor,
  intervalOf,
  overlapRatio,
  relativeWidthBps,
  type PriceInterval,
} from '@/domain/uncertainty';
import { makeQuote } from '@tests/helpers';

const interval = (
  low: number,
  high: number,
  confidence: PriceInterval['confidence'] = 'MEDIUM',
): PriceInterval => ({
  lowMinor: low,
  highMinor: high,
  centerMinor: Math.floor((low + high) / 2),
  confidence,
});

describe('confidenceFor', () => {
  it('grades an upfront fare highest and an unknown price lowest', () => {
    expect(confidenceFor('UPFRONT_QUOTE', 2840, 2840)).toBe('HIGH');
    expect(confidenceFor('ESTIMATE', 2384, 2384)).toBe('MEDIUM');
    expect(confidenceFor('METERED_ESTIMATE', 2600, 2600)).toBe('LOW');
    expect(confidenceFor('UNKNOWN', 0, 0)).toBe('INDETERMINATE');
  });

  it('downgrades a wide range but not a narrow one', () => {
    // 27–34: ~23% of the midpoint — wide.
    expect(confidenceFor('ESTIMATE_RANGE', 2700, 3400)).toBe('LOW');
    // 27.84–31.99: ~14% — still usable as a point predictor.
    expect(confidenceFor('ESTIMATE_RANGE', 2784, 3199)).toBe('MEDIUM');
  });
});

describe('relativeWidthBps', () => {
  it('measures width against the midpoint', () => {
    expect(relativeWidthBps(2700, 3400)).toBe(2295);
    expect(relativeWidthBps(2500, 2500)).toBe(0);
  });
});

describe('overlapRatio', () => {
  it('treats a point price inside a range as full containment', () => {
    // $25 exact vs $21–29 — the point sits inside the band.
    expect(overlapRatio(interval(2500, 2500), interval(2100, 2900))).toBe(1);
  });

  it('is zero for disjoint intervals', () => {
    expect(overlapRatio(interval(1000, 1500), interval(2000, 2500))).toBe(0);
  });

  it('scales overlap against the narrower interval', () => {
    expect(overlapRatio(interval(2000, 3000), interval(2800, 4800))).toBeCloseTo(0.2, 2);
  });
});

describe('compareWithUncertainty', () => {
  it('REFUSES to call a wide range cheaper than an exact fare it contains', () => {
    // The headline scenario: exact $25 vs $20–40.
    const exact = interval(2500, 2500, 'HIGH');
    const wide = interval(2000, 4000, 'LOW');
    const verdict = compareWithUncertainty(wide, exact);
    expect(verdict).not.toBe('A_CHEAPER');
    expect(verdict).toBe('SIMILAR');
    expect(headlineFor(verdict)).toBe('Similar price');
  });

  it('no overlap: states cheaper with confidence', () => {
    const cheap = interval(1800, 2000, 'HIGH');
    const dear = interval(3200, 3400, 'HIGH');
    expect(compareWithUncertainty(cheap, dear)).toBe('A_CHEAPER');
    expect(compareWithUncertainty(dear, cheap)).toBe('B_CHEAPER');
  });

  it('small overlap with firm prices: still a confident claim', () => {
    const a = interval(2000, 2600, 'MEDIUM');
    const b = interval(2550, 3400, 'MEDIUM');
    expect(overlapRatio(a, b)).toBeLessThanOrEqual(0.15);
    expect(compareWithUncertainty(a, b)).toBe('A_CHEAPER');
  });

  it('small overlap with a shaky price: hedges to "likely"', () => {
    const a = interval(2000, 2600, 'LOW');
    const b = interval(2550, 3400, 'MEDIUM');
    expect(compareWithUncertainty(a, b)).toBe('A_LIKELY_CHEAPER');
    expect(headlineFor('A_LIKELY_CHEAPER')).toBe('Likely cheapest');
  });

  it('large overlap: refuses to rank either as cheaper', () => {
    const a = interval(2400, 3200);
    const b = interval(2500, 3300);
    expect(compareWithUncertainty(a, b)).toBe('SIMILAR');
  });

  it('treats a sub-dollar gap as indistinguishable', () => {
    const a = interval(2500, 2500, 'HIGH');
    const b = interval(2560, 2560, 'HIGH');
    expect(compareWithUncertainty(a, b)).toBe('SIMILAR');
  });

  it('is antisymmetric for definite verdicts', () => {
    const a = interval(1000, 1200, 'HIGH');
    const b = interval(3000, 3200, 'HIGH');
    expect(compareWithUncertainty(a, b)).toBe('A_CHEAPER');
    expect(compareWithUncertainty(b, a)).toBe('B_CHEAPER');
  });
});

describe('intervalOf', () => {
  it('reads the quote model without re-deriving prices', () => {
    const q = makeQuote({ minMinor: 2700, maxMinor: 3400, priceType: 'ESTIMATE_RANGE' });
    const i = intervalOf(q);
    expect(i.lowMinor).toBe(2700);
    expect(i.highMinor).toBe(3400);
    expect(i.centerMinor).toBe(q.rankingPriceMinor);
  });
});
