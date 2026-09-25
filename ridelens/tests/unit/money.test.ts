import { describe, expect, it } from 'vitest';
import {
  deltaMinor,
  formatMoney,
  formatRange,
  isSupportedCurrency,
  majorToMinor,
  midpointMinor,
  minorUnitExponent,
  MoneyParseError,
  splitMinor,
  splitShareMinor,
} from '@/domain/money';

describe('majorToMinor', () => {
  it('never loses a cent to floating point', () => {
    // 23.84 * 100 === 2383.9999999999995 in IEEE-754. This is the bug.
    expect(majorToMinor(23.84, 'USD')).toBe(2384);
    expect(majorToMinor(1.005, 'USD')).toBe(101);
    expect(majorToMinor(0.07, 'USD')).toBe(7);
    expect(majorToMinor(1.1 + 2.2, 'USD')).toBe(330);
  });

  it('parses provider strings with symbols and separators', () => {
    expect(majorToMinor('$27.50', 'USD')).toBe(2750);
    expect(majorToMinor('28.40', 'USD')).toBe(2840);
    expect(majorToMinor('  31 ', 'USD')).toBe(3100);
  });

  it('honours non-2dp currencies', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(majorToMinor(2480, 'JPY')).toBe(2480);
    expect(minorUnitExponent('KWD')).toBe(3);
    expect(majorToMinor(12.345, 'KWD')).toBe(12345);
  });

  it('rounds half up on the first dropped digit', () => {
    expect(majorToMinor(1.234, 'USD')).toBe(123);
    expect(majorToMinor(1.235, 'USD')).toBe(124);
    expect(majorToMinor(1.236, 'USD')).toBe(124);
  });

  it('handles negatives symmetrically', () => {
    expect(majorToMinor(-9.12, 'USD')).toBe(-912);
  });

  it('rejects unparseable input rather than guessing', () => {
    expect(() => majorToMinor('Metered', 'USD')).toThrow(MoneyParseError);
    expect(() => majorToMinor(Number.NaN, 'USD')).toThrow(MoneyParseError);
    expect(() => majorToMinor(Number.POSITIVE_INFINITY, 'USD')).toThrow(MoneyParseError);
  });
});

describe('midpointMinor', () => {
  it('biases low so a fare is never overstated', () => {
    expect(midpointMinor(2700, 3400)).toBe(3050);
    // Odd sum: floor, not round.
    expect(midpointMinor(2700, 3401)).toBe(3050);
  });
});

describe('formatting', () => {
  it('formats point prices with full precision', () => {
    expect(formatMoney(2384, 'USD')).toBe('$23.84');
    expect(formatMoney(2840, 'USD')).toBe('$28.40');
  });

  it('renders a whole-dollar range without noise digits', () => {
    // "$27–34", never "$27.00–34.00" and never a $30.50 midpoint.
    expect(formatRange(2700, 3400, 'USD')).toBe('$27–34');
  });

  it('keeps cents when either end has them', () => {
    expect(formatRange(2784, 3199, 'USD')).toBe('$27.84–31.99');
  });

  it('degrades gracefully on an unknown currency code', () => {
    expect(formatMoney(2500, 'ZZZ')).toContain('ZZZ');
  });

  it('knows which currencies it renders confidently', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('XYZ')).toBe(false);
  });
});

describe('deltaMinor', () => {
  it('stays in integers', () => {
    expect(deltaMinor(2384, 3296)).toBe(-912);
    expect(formatMoney(Math.abs(deltaMinor(2384, 3296)), 'USD')).toBe('$9.12');
  });
});

describe('splitMinor', () => {
  it('always sums back to the total exactly', () => {
    for (const total of [2846, 2500, 1, 99999, 7]) {
      for (let n = 1; n <= 8; n += 1) {
        const parts = splitMinor(total, n);
        expect(parts).toHaveLength(n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('distributes the remainder to the earliest payers, one cent at a time', () => {
    // $28.46 between 3 is 9.4866… each. Naive rounding gives 3 × 9.49 = 28.47.
    expect(splitMinor(2846, 3)).toEqual([949, 949, 948]);
    expect(splitMinor(1000, 3)).toEqual([334, 333, 333]);
  });

  it('quotes the largest share so nobody under-pays', () => {
    expect(splitShareMinor(2846, 3)).toBe(949);
    expect(splitShareMinor(3000, 2)).toBe(1500);
  });

  it('is a no-op for one person', () => {
    expect(splitMinor(2846, 1)).toEqual([2846]);
  });

  it('rejects a nonsensical party size rather than dividing by zero', () => {
    expect(() => splitMinor(1000, 0)).toThrow(RangeError);
    expect(() => splitMinor(1000, -2)).toThrow(RangeError);
    expect(() => splitMinor(1000, 1.5)).toThrow(RangeError);
  });
});
