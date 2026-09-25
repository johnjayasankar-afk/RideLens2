import { describe, expect, it } from 'vitest';
import { buildLabel } from '@/ui/PlaceInput';
import { formatEta, formatEtaAria, formatTripDuration, priceDisplay, spoken } from '@/ui/format';
import { makeQuote } from '@tests/helpers';

describe('priceDisplay', () => {
  it('renders a range as a range and never as a midpoint', () => {
    const q = makeQuote({ priceType: 'ESTIMATE_RANGE', minMinor: 2700, maxMinor: 3400 });
    const d = priceDisplay(q);
    expect(d.text).toBe('$27–34');
    expect(d.text).not.toContain('30');
    expect(d.qualifier).toBe('Est. range');
    expect(d.ariaLabel).toMatch(/between 27 dollars and 34 dollars/);
  });

  it('labels an upfront fare distinctly from an estimate', () => {
    expect(
      priceDisplay(makeQuote({ priceType: 'UPFRONT_QUOTE', minMinor: 2840, maxMinor: 2840 }))
        .qualifier,
    ).toBe('Upfront');
    expect(
      priceDisplay(makeQuote({ priceType: 'ESTIMATE', minMinor: 2384, maxMinor: 2384 })).qualifier,
    ).toBe('Est.');
    expect(
      priceDisplay(makeQuote({ priceType: 'METERED_ESTIMATE', minMinor: 2600, maxMinor: 2600 }))
        .qualifier,
    ).toBe('Metered est.');
  });

  it('refuses to print a price it cannot characterise', () => {
    const d = priceDisplay(makeQuote({ priceType: 'UNKNOWN' }));
    expect(d.text).toBe('Price unavailable');
    expect(d.qualifier).toBeNull();
  });

  it('collapses a degenerate range to a single price', () => {
    const d = priceDisplay(
      makeQuote({ priceType: 'ESTIMATE_RANGE', minMinor: 2500, maxMinor: 2500 }),
    );
    expect(d.text).toBe('$25.00');
  });
});

describe('spoken currency', () => {
  it('speaks currency in words, not symbols', () => {
    expect(spoken(2384, 'USD')).toBe('23 dollars 84 cents');
    expect(spoken(2800, 'USD')).toBe('28 dollars');
    expect(spoken(1250, 'GBP')).toBe('12 pounds 50 pence');
  });

  it('falls back to the formatted value for an unmapped currency', () => {
    expect(spoken(2500, 'CHF')).toContain('25');
  });
});

describe('ETA vs trip duration', () => {
  it('never conflates the two', () => {
    expect(formatEta(120)).toBe('2 min');
    expect(formatEta(30)).toBe('<1 min');
    expect(formatEta(null)).toBe('ETA unknown');
    expect(formatEtaAria(120)).toMatch(/pickup in about 2 minutes/);
    expect(formatTripDuration(1980)).toBe('33 min trip');
    expect(formatTripDuration(null)).toBeNull();
  });
});

describe('buildLabel', () => {
  it('does not stutter when the secondary line repeats the primary', () => {
    expect(
      buildLabel({
        primaryText: '14 Prince St',
        secondaryText: '14 Prince St, New York, NY 10012, USA',
      }),
    ).toBe('14 Prince St, New York, NY 10012, USA');
  });

  it('joins genuinely distinct lines', () => {
    expect(buildLabel({ primaryText: 'JFK Terminal 4', secondaryText: 'Jamaica, NY' })).toBe(
      'JFK Terminal 4, Jamaica, NY',
    );
  });

  it('handles an empty or identical secondary line', () => {
    expect(buildLabel({ primaryText: 'Times Square', secondaryText: '' })).toBe('Times Square');
    expect(buildLabel({ primaryText: 'Times Square', secondaryText: 'Times Square' })).toBe(
      'Times Square',
    );
  });
});
