/**
 * The short address has one job: say which place this is, briefly, without
 * inventing anything. These cases are real geocoder output.
 */
import { describe, expect, it } from 'vitest';
import { shortAddress, shortAddressCapped } from '@/location/display';
import type { CanonicalLocation } from '@/location/types';

function loc(over: Partial<CanonicalLocation>): CanonicalLocation {
  return {
    lat: 0,
    lng: 0,
    formattedAddress: '',
    placeId: null,
    name: '',
    city: null,
    region: null,
    country: null,
    geocoder: 'osm',
    ...over,
  };
}

describe('shortAddress', () => {
  it('reduces a full Nominatim string to the words people use', () => {
    const s = shortAddress(
      loc({
        name: 'Nasdaq MarketSite',
        city: 'New York',
        region: 'New York',
        formattedAddress:
          'Nasdaq MarketSite, 4, Times Square, Manhattan Community Board 5, Manhattan, New York County, New York, 10036, United States',
      }),
    );
    expect(s).toBe('Nasdaq MarketSite, New York');
    expect(s).not.toContain('Community Board');
    expect(s).not.toContain('County');
    expect(s).not.toContain('United States');
  });

  it('does not repeat the city when the name already contains it', () => {
    expect(
      shortAddress(loc({ name: 'New York Penn Station', city: 'New York', region: 'New York' })),
    ).toBe('New York Penn Station');
  });

  it('keeps the region when it adds something', () => {
    expect(shortAddress(loc({ name: 'Union Station', city: 'Denver', region: 'Colorado' }))).toBe(
      'Union Station, Denver, Colorado',
    );
  });

  it('falls back to the specific head of a full address when there is no name', () => {
    expect(
      shortAddress(
        loc({
          city: 'New York',
          formattedAddress: '4, Times Square, New York County, New York, 10036, United States',
        }),
      ),
    ).toBe('4 Times Square, New York');
  });

  it('never returns an empty label', () => {
    expect(shortAddress(loc({}))).toBe('Selected point');
    expect(shortAddress(loc({ formattedAddress: 'Somewhere' }))).toBe('Somewhere');
  });
});

describe('shortAddressCapped', () => {
  it('cuts on a separator rather than mid-word', () => {
    const place = loc({
      name: 'John F. Kennedy International Airport Terminal 4 Arrivals',
      city: 'Queens',
      region: 'New York',
    });
    const full = shortAddress(place);
    const s = shortAddressCapped(place, 40);

    expect(s.length).toBeLessThanOrEqual(41);
    expect(s.endsWith('…')).toBe(true);

    // The real property: what is kept is a prefix of the full label, and it
    // ends where a word ends — the next character in the original is a
    // separator, not more of the same word.
    const kept = s.slice(0, -1);
    expect(full.startsWith(kept)).toBe(true);
    const next = full.charAt(kept.length);
    expect([' ', ',', ''], `cut mid-word before "${next}"`).toContain(next);
  });

  it('leaves a short label untouched', () => {
    expect(shortAddressCapped(loc({ name: 'JFK', city: 'Queens' }), 40)).toBe('JFK, Queens');
  });
});
