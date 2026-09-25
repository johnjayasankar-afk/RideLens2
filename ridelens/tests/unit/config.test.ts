/**
 * Configuration guards.
 *
 * The load-bearing assertion: a production build cannot serve fixture data,
 * no matter what the environment says.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, startupChecks } from '@/config/env';
import { clearRideLensEnv, withEnv } from '@tests/helpers';

const base = { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://ridelens.example' };

describe('demo source gating', () => {
  it('refuses fixture data in production even when the flag is set', () => {
    const cfg = loadConfig({ ...base, RIDELENS_DEMO_SOURCE: 'enabled' } as NodeJS.ProcessEnv);
    expect(cfg.isProduction).toBe(true);
    expect(cfg.demoSourceActive).toBe(false);

    const checks = startupChecks(cfg, 0);
    expect(checks.find((c) => c.code === 'DEMO_SOURCE_IN_PRODUCTION')?.level).toBe('error');
  });

  it('allows fixture data outside production when explicitly enabled', () => {
    const cfg = loadConfig({
      NODE_ENV: 'development',
      RIDELENS_DEMO_SOURCE: 'enabled',
    } as NodeJS.ProcessEnv);
    expect(cfg.demoSourceActive).toBe(true);
  });

  it('keeps fixtures off by default', () => {
    expect(loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).demoSourceActive).toBe(
      false,
    );
  });

  it('refuses the fixture geocoder in production', () => {
    expect(() =>
      loadConfig({ ...base, GEOCODER_PROVIDER: 'fixture' } as NodeJS.ProcessEnv),
    ).toThrow(/not permitted in production/i);
  });
});

describe('geocoder selection', () => {
  it('falls back to the keyless OSM geocoder when no key is present', () => {
    expect(loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).geocoderProvider).toBe(
      'osm',
    );
  });

  it('prefers a configured commercial provider', () => {
    expect(
      loadConfig({
        NODE_ENV: 'development',
        LOCATION_PROVIDER_API_KEY: 'AIzaSyTest',
      } as NodeJS.ProcessEnv).geocoderProvider,
    ).toBe('google');
    expect(
      loadConfig({
        NODE_ENV: 'development',
        LOCATION_PROVIDER_API_KEY: 'tok',
        NEXT_PUBLIC_MAP_KEY: 'pk.eyJtest',
      } as NodeJS.ProcessEnv).geocoderProvider,
    ).toBe('mapbox');
  });

  it('honours an explicit override', () => {
    expect(
      loadConfig({
        NODE_ENV: 'development',
        GEOCODER_PROVIDER: 'mapbox',
        LOCATION_PROVIDER_API_KEY: 'x',
      } as NodeJS.ProcessEnv).geocoderProvider,
    ).toBe('mapbox');
  });
});

describe('startupChecks', () => {
  it('flags a production deployment with no live source as an error', () => {
    const cfg = loadConfig(base as NodeJS.ProcessEnv);
    const check = startupChecks(cfg, 0).find((c) => c.code === 'NO_LIVE_QUOTE_SOURCE');
    expect(check?.level).toBe('error');
  });

  it('only warns in development', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(startupChecks(cfg, 0).find((c) => c.code === 'NO_LIVE_QUOTE_SOURCE')?.level).toBe(
      'warn',
    );
  });

  it('refuses in-memory persistence and limiting in production', () => {
    const cfg = loadConfig(base as NodeJS.ProcessEnv);
    const codes = startupChecks(cfg, 1).map((c) => c.code);
    expect(codes).toContain('NO_DURABLE_PERSISTENCE');
    expect(codes).toContain('NO_DURABLE_RATE_LIMITER');
  });

  it('is clean when production is fully configured', () => {
    const cfg = loadConfig({
      ...base,
      NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      UPSTASH_REDIS_REST_URL: 'https://redis.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      LOCATION_PROVIDER_API_KEY: 'geo-key',
      TOKEN_ENCRYPTION_KEY: 'a'.repeat(44),
      OBI_API_KEY: 'obi-key',
    } as NodeJS.ProcessEnv);
    expect(startupChecks(cfg, 1).filter((c) => c.level === 'error')).toHaveLength(0);
  });

  it('warns that the keyless geocoder is not consumer scale', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(startupChecks(cfg, 1).find((c) => c.code === 'KEYLESS_GEOCODER')?.level).toBe('warn');
  });
});

describe('validation', () => {
  it('rejects an out-of-range timeout rather than silently clamping', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        QUOTE_REQUEST_TIMEOUT_MS: '99999',
      } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid RideLens configuration/);
  });

  it('rejects a malformed app URL', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'notaurl' } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid RideLens configuration/);
  });
});

describe('source enablement gates', () => {
  beforeEach(() => clearRideLensEnv());
  afterEach(() => clearRideLensEnv());

  it('keeps every CREDENTIALED source off when nothing is configured', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { allSources, enabledSources } = await import('@/sources/registry');
    expect(allSources().length).toBeGreaterThan(0);
    // The published rate card is disabled by the test harness; everything else
    // needs a credential nobody supplied.
    expect(enabledSources()).toHaveLength(0);
  });

  it('enables the published rate card with no credential at all', async () => {
    // The real product default: no keys, no contracts, still a live source.
    withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: undefined });
    const { enabledLiveSources } = await import('@/sources/registry');
    const ids = enabledLiveSources().map((s) => s.capabilities().sourceId);
    expect(ids).toContain('public_rate_card');
  });

  it('lets an operator switch the rate card off', async () => {
    withEnv({ NODE_ENV: 'development', ENABLE_PUBLIC_RATE_CARD: 'false' });
    const { sourceById } = await import('@/sources/registry');
    expect(sourceById('public_rate_card')?.enablement().enabled).toBe(false);
  });

  it('blocks the direct Uber adapter on policy, not on a missing key', async () => {
    withEnv({ NODE_ENV: 'development', UBER_SERVER_TOKEN: 'token-present' });
    const { sourceById } = await import('@/sources/registry');
    const gate = sourceById('uber_direct')?.enablement();
    expect(gate?.enabled).toBe(false);
    expect(gate?.blockerCode).toBe('POLICY_PROHIBITED');
    expect(gate?.blockerMessage).toMatch(/Terms of Use/i);
  });

  it('enables the direct Uber adapter only when comparison rights are asserted', async () => {
    withEnv({
      NODE_ENV: 'development',
      UBER_SERVER_TOKEN: 'token',
      UBER_COMPARISON_RIGHTS_GRANTED: 'true',
    });
    const { sourceById } = await import('@/sources/registry');
    expect(sourceById('uber_direct')?.enablement().enabled).toBe(true);
  });

  it('reports Lyft as having no public endpoint rather than a missing key', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { sourceById } = await import('@/sources/registry');
    expect(sourceById('lyft_direct')?.enablement().blockerCode).toBe('NO_PUBLIC_ENDPOINT');
  });

  it('reports Obi and Curb as needing partner approval', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { sourceById } = await import('@/sources/registry');
    expect(sourceById('obi')?.enablement().blockerCode).toBe('PARTNER_APPROVAL_REQUIRED');
    expect(sourceById('curb_flow')?.enablement().blockerCode).toBe('PARTNER_APPROVAL_REQUIRED');
  });

  it('enables Obi as soon as a key exists', async () => {
    withEnv({ NODE_ENV: 'development', OBI_API_KEY: 'k' });
    const { enabledLiveSources } = await import('@/sources/registry');
    expect(enabledLiveSources().map((s) => s.capabilities().sourceId)).toContain('obi');
  });

  it('never counts the fixture source as a live source', async () => {
    withEnv({ NODE_ENV: 'development', RIDELENS_DEMO_SOURCE: 'enabled' });
    const { enabledSources, enabledLiveSources } = await import('@/sources/registry');
    expect(enabledSources().map((s) => s.capabilities().sourceId)).toContain('demo_fixture');
    // With the rate card off in the harness, no live source remains.
    expect(enabledLiveSources()).toHaveLength(0);
  });
});
