import { describe, expect, it } from 'vitest';
import { bucketLimit } from '@/app/api/_lib/request';
import { clientKey, MemoryRateLimiter } from '@/orchestration/ratelimit';

describe('MemoryRateLimiter', () => {
  it('allows up to the limit and refuses beyond it', async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i += 1) {
      expect((await limiter.check('k', 3, 60)).allowed).toBe(true);
    }
    const denied = await limiter.check('k', 3, 60);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it('reports remaining budget accurately', async () => {
    const limiter = new MemoryRateLimiter();
    expect((await limiter.check('k', 5, 60)).remaining).toBe(4);
    expect((await limiter.check('k', 5, 60)).remaining).toBe(3);
  });

  it('keys are independent', async () => {
    const limiter = new MemoryRateLimiter();
    await limiter.check('a', 1, 60);
    expect((await limiter.check('a', 1, 60)).allowed).toBe(false);
    expect((await limiter.check('b', 1, 60)).allowed).toBe(true);
  });

  it('resets after the window elapses', async () => {
    const limiter = new MemoryRateLimiter();
    await limiter.check('k', 1, 1);
    expect((await limiter.check('k', 1, 1)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await limiter.check('k', 1, 1)).allowed).toBe(true);
  });
});

describe('clientKey', () => {
  it('hashes the client identifier rather than storing it', async () => {
    const key = await clientKey('compare', '203.0.113.9');
    expect(key).toMatch(/^rl:compare:[0-9a-f]{24}$/);
    expect(key).not.toContain('203.0.113.9');
  });

  it('is stable for the same input and distinct across inputs', async () => {
    expect(await clientKey('compare', '1.2.3.4')).toBe(await clientKey('compare', '1.2.3.4'));
    expect(await clientKey('compare', '1.2.3.4')).not.toBe(await clientKey('compare', '1.2.3.5'));
    expect(await clientKey('compare', '1.2.3.4')).not.toBe(await clientKey('handoff', '1.2.3.4'));
  });

  it('handles an unknown client without throwing', async () => {
    expect(await clientKey('compare', null)).toMatch(/^rl:compare:/);
  });
});

describe('bucketLimit', () => {
  it('scales each bucket from one configurable base', () => {
    expect(bucketLimit('compare', 30)).toBe(30);
    // Autocomplete fires per keystroke, so it gets a much larger budget.
    expect(bucketLimit('geocode', 30)).toBe(180);
    expect(bucketLimit('handoff', 30)).toBe(60);
  });

  it('defaults an unknown bucket to the base rather than to unlimited', () => {
    expect(bucketLimit('something-new', 30)).toBe(30);
  });

  it('never returns a limit below one', () => {
    expect(bucketLimit('compare', 0)).toBe(1);
  });
});
