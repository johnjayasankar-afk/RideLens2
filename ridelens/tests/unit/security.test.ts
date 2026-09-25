/** Security-critical behaviour: booking allowlist, redaction, cache isolation. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allBookingHosts, validateAppUrl, validateBookingUrl } from '@/booking/allowlist';
import { cacheKey, InMemoryQuoteCache } from '@/orchestration/cache';
import { analyticsGeo, redact } from '@/observability/logger';
import { clearRideLensEnv, DESTINATION, PICKUP, withEnv } from '@tests/helpers';
import type { SourceQuoteResult } from '@/sources/types';

describe('booking URL allowlist', () => {
  it('accepts a documented provider host', () => {
    expect(validateBookingUrl('https://m.uber.com/looking?client_id=x', 'uber').ok).toBe(true);
    expect(validateBookingUrl('https://lyft.com/ride?id=lyft', 'lyft').ok).toBe(true);
    expect(validateBookingUrl('https://gocurb.com/', 'curb').ok).toBe(true);
  });

  it('rejects a lookalike host that would pass a naive suffix check', () => {
    // The classic open-redirect bypass.
    expect(validateBookingUrl('https://m.uber.com.evil.tld/looking', 'uber').ok).toBe(false);
    expect(validateBookingUrl('https://evil.tld/?x=lyft.com', 'lyft').ok).toBe(false);
    expect(validateBookingUrl('https://notlyft.com/ride', 'lyft').ok).toBe(false);
  });

  it("rejects one provider's host used for another provider", () => {
    expect(validateBookingUrl('https://lyft.com/ride', 'uber').ok).toBe(false);
  });

  it('rejects non-HTTPS, embedded credentials and malformed URLs', () => {
    expect(validateBookingUrl('http://m.uber.com/looking', 'uber').ok).toBe(false);
    expect(validateBookingUrl('https://user:pass@m.uber.com/', 'uber').ok).toBe(false);
    expect(validateBookingUrl('javascript:alert(1)', 'uber').ok).toBe(false);
    expect(validateBookingUrl('not a url', 'uber').ok).toBe(false);
  });

  it('rejects a provider with no booking hosts at all', () => {
    expect(validateBookingUrl('https://anything.com/', 'other').ok).toBe(false);
  });

  it('allowlists app schemes per provider only', () => {
    expect(validateAppUrl('uber://riderequest?x=1', 'uber').ok).toBe(true);
    expect(validateAppUrl('lyft://ridetype', 'uber').ok).toBe(false);
    expect(validateAppUrl('javascript:alert(1)', 'uber').ok).toBe(false);
  });

  it('exposes a non-empty flattened host list for the server guard', () => {
    expect(allBookingHosts().length).toBeGreaterThan(0);
  });
});

describe('log redaction', () => {
  it('removes credentials by key name', () => {
    const out = redact({
      OBI_API_KEY: 'secret-value',
      authorization: 'Bearer abc',
      refreshToken: 'xyz',
      safe: 'kept',
    }) as Record<string, unknown>;
    expect(out.OBI_API_KEY).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.refreshToken).toBe('[redacted]');
    expect(out.safe).toBe('kept');
  });

  it('removes coordinates and addresses', () => {
    const out = redact({
      lat: 40.7233,
      lng: -73.9959,
      formattedAddress: '14 Prince St, New York',
      nested: { latitude: 1.23, address: 'somewhere' },
    }) as Record<string, unknown>;
    expect(out.lat).toBe('[coord]');
    expect(out.lng).toBe('[coord]');
    expect(out.formattedAddress).toBe('[address]');
    expect((out.nested as Record<string, unknown>).latitude).toBe('[coord]');
  });

  it('scrubs coordinates embedded in free text', () => {
    expect(redact('failed for 40.72331,-73.99591')).toBe('failed for [coord],[coord]');
  });

  it('coarsens analytics geo to roughly a kilometre', () => {
    expect(analyticsGeo(40.723312, -73.995912)).toEqual({ lat: 40.72, lng: -74 });
  });
});

describe('quote cache isolation', () => {
  const result = (n: number): SourceQuoteResult => ({
    sourceId: 'obi',
    quotes: [],
    providersAttempted: ['uber'],
    fetchedAt: new Date().toISOString(),
    latencyMs: n,
    warnings: [],
  });

  it("never lets one user's account-linked price into another user's key", () => {
    const base = {
      sourceId: 'obi' as const,
      pickup: PICKUP,
      destination: DESTINATION,
      locale: 'en-US',
      partySize: 1,
    };
    const userA = cacheKey({ ...base, accountContext: 'ACCOUNT_LINKED', accountScope: 'user-a' });
    const userB = cacheKey({ ...base, accountContext: 'ACCOUNT_LINKED', accountScope: 'user-b' });
    const anon = cacheKey({ ...base, accountContext: 'PUBLIC' });
    expect(userA).not.toBe(userB);
    expect(userA).not.toBe(anon);
    expect(anon).toContain(':public:');
  });

  it('separates sources, locales and routes', () => {
    const base = {
      pickup: PICKUP,
      destination: DESTINATION,
      accountContext: 'PUBLIC' as const,
      locale: 'en-US',
      partySize: 1,
    };
    expect(cacheKey({ ...base, sourceId: 'obi' })).not.toBe(
      cacheKey({ ...base, sourceId: 'curb_flow' }),
    );
    expect(cacheKey({ ...base, sourceId: 'obi' })).not.toBe(
      cacheKey({ ...base, sourceId: 'obi', locale: 'fr-FR' }),
    );
    expect(cacheKey({ ...base, sourceId: 'obi' })).not.toBe(
      cacheKey({ ...base, sourceId: 'obi', destination: { ...DESTINATION, lat: 41.0 } }),
    );
    // Party size is part of the price in Chicago and DC, so it must be part of
    // the key: a party of four must never be served a fare quoted for one.
    expect(cacheKey({ ...base, sourceId: 'public_rate_card' })).not.toBe(
      cacheKey({ ...base, sourceId: 'public_rate_card', partySize: 4 }),
    );
  });

  it('shares an entry across coordinates too close to change a fare', () => {
    const base = {
      sourceId: 'obi' as const,
      destination: DESTINATION,
      accountContext: 'PUBLIC' as const,
      locale: 'en-US',
      partySize: 1,
    };
    // ~0.5 m apart.
    const a = cacheKey({ ...base, pickup: PICKUP });
    const b = cacheKey({ ...base, pickup: { ...PICKUP, lat: PICKUP.lat + 0.000004 } });
    expect(a).toBe(b);
  });

  it('expires entries and refuses to cache when TTL is zero', () => {
    const cache = new InMemoryQuoteCache();
    const now = Date.now();
    cache.set('k', result(1), 20, now);
    // Comfortably alive.
    expect(cache.get('k', now + 10_000)).not.toBeNull();
    // One second before the TTL used to be a hit. It is not any more: an entry
    // in the last fifth of its life would hand the rider a price that expires
    // while they read it, so it is treated as a miss. See MIN_REMAINING_LIFE.
    cache.set('k', result(1), 20, now);
    expect(cache.get('k', now + 19_000)).toBeNull();

    cache.set('k', result(1), 20, now);
    expect(cache.get('k', now + 21_000)).toBeNull();

    cache.set('zero', result(1), 0, now);
    expect(cache.get('zero', now)).toBeNull();
  });

  it('evicts rather than growing without bound', () => {
    const cache = new InMemoryQuoteCache(3);
    for (let i = 0; i < 10; i += 1) cache.set(`k${i}`, result(i), 60);
    expect(cache.size()).toBeLessThanOrEqual(3);
  });
});

describe('SSRF containment in the shared HTTP client', () => {
  beforeEach(() => clearRideLensEnv());
  afterEach(() => clearRideLensEnv());

  it('refuses a host that is not on the call-site allowlist', async () => {
    const { httpJson, HttpError } = await import('@/sources/http');
    await expect(
      httpJson('https://attacker.example/data', {
        timeoutMs: 500,
        allowedHosts: ['api.rideobi.com'],
      }),
    ).rejects.toMatchObject({ kind: 'BLOCKED' });
    expect(HttpError).toBeDefined();
  });

  it('refuses plain HTTP outright', async () => {
    const { httpJson } = await import('@/sources/http');
    await expect(
      httpJson('http://api.rideobi.com/v1/quotes', {
        timeoutMs: 500,
        allowedHosts: ['api.rideobi.com'],
      }),
    ).rejects.toMatchObject({ kind: 'BLOCKED' });
  });

  it('permits a subdomain of an allowlisted host', async () => {
    withEnv({});
    const { httpJson } = await import('@/sources/http');
    // Reaches the network layer rather than being blocked; any failure past
    // that point is a network error, not a BLOCKED verdict.
    await expect(
      httpJson('https://sub.example.com/x', { timeoutMs: 1, allowedHosts: ['example.com'] }),
    ).rejects.not.toMatchObject({ kind: 'BLOCKED' });
  });
});
