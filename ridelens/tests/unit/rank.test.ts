import { describe, expect, it } from 'vitest';
import { rankSuggestions, scoreSuggestion } from '@/location/rank';
import type { PlaceSuggestion } from '@/location/types';

const s = (
  primaryText: string,
  kind: PlaceSuggestion['kind'],
  secondaryText = '',
): PlaceSuggestion => ({
  id: primaryText,
  primaryText,
  secondaryText,
  kind,
  lat: 40,
  lng: -73,
});

describe('rankSuggestions', () => {
  it('puts the airport above its own car park', () => {
    // The real failure this exists for: choosing the car park silently changes
    // the destination, and with it the regulated flat fare.
    const ranked = rankSuggestions('JFK Airport', [
      s('JFK Airport Employee Parking', 'VENUE', 'Lefferts Boulevard, New York'),
      s('John F. Kennedy International Airport', 'AIRPORT', 'Queens, New York'),
      s('Sutphin Blvd–Archer Av–JFK Airport', 'OTHER', 'Archer Avenue'),
    ]);
    expect(ranked[0]?.kind).toBe('AIRPORT');
  });

  it('demotes cargo, rental and long-term lots for an airport query', () => {
    const ranked = rankSuggestions('SFO', [
      s('SFO Long-Term Parking', 'VENUE'),
      s('SFO Rental Car Center', 'VENUE'),
      s('San Francisco International Airport', 'AIRPORT'),
    ]);
    expect(ranked[0]?.primaryText).toBe('San Francisco International Airport');
  });

  it('recognises a bare IATA code as an airport query', () => {
    expect(scoreSuggestion('ORD', s("O'Hare International Airport", 'AIRPORT'))).toBeGreaterThan(
      scoreSuggestion('ORD', s('ORD Economy Lot', 'VENUE')),
    );
  });

  it('prefers an exact match over a longer name that contains it', () => {
    const ranked = rankSuggestions('Times Square', [
      s('Times Square Church', 'VENUE'),
      s('Times Square', 'LANDMARK'),
    ]);
    expect(ranked[0]?.primaryText).toBe('Times Square');
  });

  it('leaves a sensible ordering alone', () => {
    const input = [s('14 Prince St', 'ADDRESS'), s('14 Prince Street, Brooklyn', 'ADDRESS')];
    expect(rankSuggestions('14 Prince St', input)[0]?.primaryText).toBe('14 Prince St');
  });

  it('is stable for equal scores, so results never shuffle between keystrokes', () => {
    const input = [s('Alpha Place', 'ADDRESS'), s('Alpha Place', 'ADDRESS')];
    const a = rankSuggestions('zzz', input);
    const b = rankSuggestions('zzz', input);
    expect(a.map((x) => x.primaryText)).toEqual(b.map((x) => x.primaryText));
  });

  it('handles an empty list', () => {
    expect(rankSuggestions('anything', [])).toEqual([]);
  });
});
