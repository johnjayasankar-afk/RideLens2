import { describe, expect, it } from 'vitest';
import { capacityFor, filterByParty, fitsParty, MAX_PARTY_SIZE } from '@/domain/capacity';
import { makeQuote } from '@tests/helpers';

describe('capacityFor', () => {
  it('models standard cars at four and XL at six', () => {
    expect(capacityFor(makeQuote({ category: 'STANDARD', productName: 'UberX' })).seats).toBe(4);
    expect(capacityFor(makeQuote({ category: 'XL', productName: 'UberXL' })).seats).toBe(6);
    expect(capacityFor(makeQuote({ category: 'TAXI', productName: 'Curb Taxi' })).seats).toBe(4);
  });

  it('lets an SUV product override its luxury category', () => {
    expect(capacityFor(makeQuote({ category: 'LUXURY', productName: 'Black SUV' })).seats).toBe(6);
    expect(capacityFor(makeQuote({ category: 'LUXURY', productName: 'Uber Black' })).seats).toBe(4);
  });

  it('always reports itself as a model, never as provider data', () => {
    expect(capacityFor(makeQuote()).provenance).toBe('MODEL');
  });
});

describe('fitsParty', () => {
  it('never filters a solo rider', () => {
    expect(fitsParty(makeQuote({ category: 'SHARED', productName: 'UberX Share' }), 1)).toBe(true);
  });

  it('excludes a four-seat car for a party of five', () => {
    expect(fitsParty(makeQuote({ category: 'STANDARD', productName: 'UberX' }), 5)).toBe(false);
    expect(fitsParty(makeQuote({ category: 'XL', productName: 'UberXL' }), 5)).toBe(true);
  });

  it('is conservative at the boundary', () => {
    // Four passengers exactly fills a four-seat car; five does not.
    const standard = makeQuote({ category: 'STANDARD', productName: 'UberX' });
    expect(fitsParty(standard, 4)).toBe(true);
    expect(fitsParty(standard, 5)).toBe(false);
  });
});

describe('filterByParty', () => {
  const quotes = [
    makeQuote({ id: 'x', category: 'STANDARD', productName: 'UberX' }),
    makeQuote({ id: 'xl', category: 'XL', productName: 'UberXL' }),
    makeQuote({ id: 'suv', category: 'LUXURY', productName: 'Black SUV' }),
  ];

  it('returns everything for one passenger', () => {
    expect(filterByParty(quotes, 1)).toHaveLength(3);
  });

  it('keeps only vehicles that seat the group', () => {
    expect(filterByParty(quotes, 5).map((q) => q.id)).toEqual(['xl', 'suv']);
  });

  it('handles the maximum party size without emptying by accident', () => {
    expect(filterByParty(quotes, MAX_PARTY_SIZE).map((q) => q.id)).toEqual(['xl', 'suv']);
  });
});
