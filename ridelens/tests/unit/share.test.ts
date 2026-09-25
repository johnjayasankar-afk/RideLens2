import { describe, expect, it } from 'vitest';
import {
  isExpired,
  isValidShareId,
  newShareId,
  SHARE_TTL_DAYS,
  shareExpiry,
  tripSummary,
  type SharedRoute,
} from '@/domain/share';
import { DESTINATION, PICKUP } from '@tests/helpers';

describe('share ids', () => {
  it('are 12 characters of an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = newShareId();
      expect(id).toHaveLength(12);
      expect(isValidShareId(id)).toBe(true);
      // Characters that get misread aloud or in a font are excluded.
      expect(id).not.toMatch(/[ilou]/);
    }
  });

  it('do not collide across a large sample', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newShareId()));
    expect(ids.size).toBe(5000);
  });

  it('reject malformed input', () => {
    expect(isValidShareId('')).toBe(false);
    expect(isValidShareId('short')).toBe(false);
    expect(isValidShareId('../../etc/pw')).toBe(false);
    expect(isValidShareId('AAAAAAAAAAAA')).toBe(false);
    expect(isValidShareId('iiiiiiiiiiii')).toBe(false);
  });
});

describe('expiry', () => {
  it('expires after the documented TTL', () => {
    const now = Date.parse('2026-09-03T00:00:00.000Z');
    const route: SharedRoute = {
      id: newShareId(),
      pickup: PICKUP,
      destination: DESTINATION,
      createdAt: new Date(now).toISOString(),
      expiresAt: shareExpiry(now),
    };
    expect(isExpired(route, now)).toBe(false);
    expect(isExpired(route, now + (SHARE_TTL_DAYS - 1) * 86_400_000)).toBe(false);
    expect(isExpired(route, now + (SHARE_TTL_DAYS + 1) * 86_400_000)).toBe(true);
  });
});

describe('tripSummary', () => {
  it('always states that the provider confirms the fare', () => {
    const text = tripSummary({ pickup: '14 Prince St', destination: 'JFK' });
    expect(text).toContain('Final fare is confirmed in the provider app.');
  });

  it('labels a price with its semantics rather than stating it bare', () => {
    const text = tripSummary({
      pickup: '14 Prince St',
      destination: 'JFK',
      provider: 'Empower',
      product: 'Everyday',
      price: '$23.84',
      priceQualifier: 'Est.',
      observedAt: '3 Sept 2026, 18:22',
    });
    expect(text).toContain('Observed price: $23.84 (Est.)');
    expect(text).toContain('Observed at: 3 Sept 2026, 18:22');
  });

  it('omits price lines entirely when no price is supplied', () => {
    const text = tripSummary({ pickup: 'A', destination: 'B' });
    expect(text).not.toMatch(/Observed price/);
  });
});
