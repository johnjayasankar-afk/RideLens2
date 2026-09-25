import { describe, expect, it } from 'vitest';
import {
  categorizeProduct,
  SEGREGATED_CATEGORIES,
  STANDARD_VIEW_CATEGORIES,
} from '@/domain/taxonomy';

describe('categorizeProduct', () => {
  it('maps Uber products, keeping Black out of STANDARD', () => {
    expect(categorizeProduct({ provider: 'uber', productId: 'x', productName: 'UberX' })).toBe(
      'STANDARD',
    );
    expect(categorizeProduct({ provider: 'uber', productId: 'x', productName: 'UberXL' })).toBe(
      'XL',
    );
    expect(categorizeProduct({ provider: 'uber', productId: 'x', productName: 'Black' })).toBe(
      'LUXURY',
    );
    expect(categorizeProduct({ provider: 'uber', productId: 'x', productName: 'Black SUV' })).toBe(
      'LUXURY',
    );
    expect(categorizeProduct({ provider: 'uber', productId: 'x', productName: 'Comfort' })).toBe(
      'PREMIUM',
    );
    expect(categorizeProduct({ provider: 'uber', productId: 'x', productName: 'Green' })).toBe(
      'EV',
    );
    expect(
      categorizeProduct({ provider: 'uber', productId: 'x', productName: 'UberX Share' }),
    ).toBe('SHARED');
    expect(categorizeProduct({ provider: 'uber', productId: 'x', productName: 'UberWAV' })).toBe(
      'ACCESSIBLE',
    );
  });

  it('maps Lyft products', () => {
    expect(categorizeProduct({ provider: 'lyft', productId: 'lyft', productName: 'Lyft' })).toBe(
      'STANDARD',
    );
    expect(
      categorizeProduct({ provider: 'lyft', productId: 'lyft_xl', productName: 'Lyft XL' }),
    ).toBe('XL');
    expect(
      categorizeProduct({ provider: 'lyft', productId: 'lyft_luxsuv', productName: 'Black SUV' }),
    ).toBe('LUXURY');
    expect(
      categorizeProduct({ provider: 'lyft', productId: 'lyft_plus', productName: 'Extra Comfort' }),
    ).toBe('PREMIUM');
  });

  it('maps Empower tiers, distinguishing Premium XL from Premium', () => {
    expect(
      categorizeProduct({ provider: 'empower', productId: 'everyday', productName: 'Everyday' }),
    ).toBe('STANDARD');
    expect(
      categorizeProduct({ provider: 'empower', productId: 'x', productName: 'Everyday XL' }),
    ).toBe('XL');
    expect(categorizeProduct({ provider: 'empower', productId: 'x', productName: 'Premium' })).toBe(
      'PREMIUM',
    );
    expect(
      categorizeProduct({ provider: 'empower', productId: 'x', productName: 'Premium XL' }),
    ).toBe('XL');
  });

  it('keeps Curb taxi supply in TAXI rather than folding it into STANDARD', () => {
    expect(
      categorizeProduct({ provider: 'curb', productId: 'taxi', productName: 'Curb Taxi' }),
    ).toBe('TAXI');
    expect(
      categorizeProduct({ provider: 'curb', productId: 'x', productName: 'Curb Standard' }),
    ).toBe('TAXI');
    expect(
      categorizeProduct({ provider: 'curb', productId: 'x', productName: 'Wheelchair Accessible' }),
    ).toBe('ACCESSIBLE');
  });

  it('falls back to OTHER for an unrecognised product instead of guessing', () => {
    // A renamed product must never be silently assumed to be a standard car.
    expect(
      categorizeProduct({ provider: 'uber', productId: 'zz', productName: 'UberBrandNewThing' }),
    ).toBe('OTHER');
    expect(categorizeProduct({ provider: 'other', productId: 'zz', productName: 'Anything' })).toBe(
      'OTHER',
    );
  });

  it('classifies Waymo as autonomous', () => {
    expect(categorizeProduct({ provider: 'waymo', productId: 'w', productName: 'Waymo One' })).toBe(
      'AUTONOMOUS',
    );
  });
});

describe('category groupings', () => {
  it('includes taxi in the default cheapest view but not XL or luxury', () => {
    expect(STANDARD_VIEW_CATEGORIES).toContain('TAXI');
    expect(STANDARD_VIEW_CATEGORIES).toContain('STANDARD');
    expect(STANDARD_VIEW_CATEGORIES).not.toContain('XL');
    expect(SEGREGATED_CATEGORIES).toContain('LUXURY');
    expect(SEGREGATED_CATEGORIES).toContain('XL');
  });
});
