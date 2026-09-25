import { describe, expect, it } from 'vitest';
import {
  computeFreshness,
  formatAge,
  formatExpiry,
  isPresentable,
  refreshQuoteFreshness,
} from '@/domain/freshness';
import { makeQuote } from '@tests/helpers';

const T0 = Date.parse('2026-09-03T18:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();

describe('computeFreshness', () => {
  it('ages through LIVE, RECENT, STALE, EXPIRED', () => {
    expect(computeFreshness(at(0), null, T0 + 1_000)).toBe('LIVE');
    expect(computeFreshness(at(0), null, T0 + 19_000)).toBe('LIVE');
    expect(computeFreshness(at(0), null, T0 + 45_000)).toBe('RECENT');
    expect(computeFreshness(at(0), null, T0 + 120_000)).toBe('STALE');
    expect(computeFreshness(at(0), null, T0 + 400_000)).toBe('EXPIRED');
  });

  it('lets a provider expiry override the age heuristic', () => {
    // Only 5 s old, but the provider says it is already dead.
    expect(computeFreshness(at(0), at(4_000), T0 + 5_000)).toBe('EXPIRED');
  });

  it('tolerates small clock skew rather than reporting a future quote expired', () => {
    expect(computeFreshness(at(2_000), null, T0)).toBe('LIVE');
  });

  it('treats an unparseable timestamp as expired, never as fresh', () => {
    expect(computeFreshness('not-a-date', null, T0)).toBe('EXPIRED');
  });
});

describe('isPresentable', () => {
  it('excludes expired quotes from being shown as current', () => {
    expect(isPresentable(makeQuote({ freshness: 'STALE' }))).toBe(true);
    expect(isPresentable(makeQuote({ freshness: 'EXPIRED' }))).toBe(false);
  });
});

describe('refreshQuoteFreshness', () => {
  it('re-derives freshness at read time so a card ages on screen', () => {
    const q = makeQuote({ receivedAt: at(0), freshness: 'LIVE' });
    expect(refreshQuoteFreshness(q, T0 + 5_000).freshness).toBe('LIVE');
    expect(refreshQuoteFreshness(q, T0 + 90_000).freshness).toBe('STALE');
    expect(refreshQuoteFreshness(q, T0 + 500_000).freshness).toBe('EXPIRED');
  });

  it('returns the same object when nothing changed', () => {
    const q = makeQuote({ receivedAt: at(0), freshness: 'LIVE' });
    expect(refreshQuoteFreshness(q, T0 + 1_000)).toBe(q);
  });
});

describe('display helpers', () => {
  it('formats age in human units', () => {
    expect(formatAge(at(0), T0 + 1_000)).toBe('Just now');
    expect(formatAge(at(0), T0 + 12_000)).toBe('12 sec ago');
    expect(formatAge(at(0), T0 + 125_000)).toBe('2 min ago');
  });

  it('counts down a provider expiry', () => {
    expect(formatExpiry(at(84_000), T0)).toBe('Quote expires in 1:24');
    expect(formatExpiry(at(-1), T0)).toBe('Quote expired');
    // No expiry from the provider means no countdown is invented.
    expect(formatExpiry(null, T0)).toBeNull();
  });
});
