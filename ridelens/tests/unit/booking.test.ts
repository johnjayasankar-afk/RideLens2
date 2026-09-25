import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requiresInterstitial, resolveBookingHandoff } from '@/booking/resolver';
import { clearRideLensEnv, DESTINATION, PICKUP, withEnv } from '@tests/helpers';

const args = {
  pickup: PICKUP,
  destination: DESTINATION,
  providerProductId: null as string | null,
  sourceSuppliedUrl: null as string | null,
};

beforeEach(() => clearRideLensEnv());
afterEach(() => clearRideLensEnv());

describe('Uber handoff', () => {
  it('builds the current universal link when attribution is configured', () => {
    withEnv({ NODE_ENV: 'development', UBER_DEEPLINK_CLIENT_ID: 'client-abc' });
    const h = resolveBookingHandoff({ ...args, provider: 'uber' });
    const url = new URL(h!.url as string);
    expect(url.origin + url.pathname).toBe('https://m.uber.com/looking');
    expect(url.searchParams.get('client_id')).toBe('client-abc');

    const pickup = JSON.parse(url.searchParams.get('pickup') as string);
    expect(pickup.latitude).toBe(PICKUP.lat);
    expect(pickup.addressLine2).toBe(PICKUP.formattedAddress);

    const drop = JSON.parse(url.searchParams.get('drop[0]') as string);
    expect(drop.latitude).toBe(DESTINATION.lat);

    expect(h!.prefilledFields).toEqual(['pickup', 'destination']);
    // Never claimed as verified until a human has confirmed it in the app.
    expect(h!.prefillVerification).toBe('UNVERIFIED');
  });

  it('adds product_id only for a well-formed Uber product UUID', () => {
    withEnv({ NODE_ENV: 'development', UBER_DEEPLINK_CLIENT_ID: 'c' });
    const uuid = 'a1111c8c-c720-46c3-8534-2fcdd730040d';
    const withUuid = resolveBookingHandoff({ ...args, provider: 'uber', providerProductId: uuid });
    expect(new URL(withUuid!.url as string).searchParams.get('product_id')).toBe(uuid);
    expect(withUuid!.prefilledFields).toContain('product');

    const withSlug = resolveBookingHandoff({
      ...args,
      provider: 'uber',
      providerProductId: 'uberx',
    });
    expect(new URL(withSlug!.url as string).searchParams.get('product_id')).toBeNull();
    expect(withSlug!.prefilledFields).not.toContain('product');
  });

  it('degrades honestly to a generic handoff with no attribution', () => {
    withEnv({ NODE_ENV: 'development' });
    const h = resolveBookingHandoff({ ...args, provider: 'uber' });
    expect(h!.kind).toBe('GENERIC');
    expect(h!.prefilledFields).toEqual([]);
    expect(h!.prefillVerification).toBe('NOT_APPLICABLE');
    expect(h!.note).toMatch(/cannot be prefilled/i);
    expect(requiresInterstitial(h!)).toBe(true);
  });
});

describe('Lyft handoff', () => {
  it('builds the current universal link with bracketed coordinates', () => {
    withEnv({ NODE_ENV: 'development', LYFT_CLIENT_ID: 'partner-1' });
    const h = resolveBookingHandoff({ ...args, provider: 'lyft', providerProductId: 'lyft_xl' });
    const url = new URL(h!.url as string);
    expect(url.origin + url.pathname).toBe('https://lyft.com/ride');
    expect(url.searchParams.get('partner')).toBe('partner-1');
    expect(url.searchParams.get('id')).toBe('lyft_xl');
    expect(url.searchParams.get('pickup[latitude]')).toBe(PICKUP.lat.toFixed(6));
    expect(url.searchParams.get('destination[longitude]')).toBe(DESTINATION.lng.toFixed(6));
  });

  it('degrades to ride.lyft.com without a partner id', () => {
    withEnv({ NODE_ENV: 'development' });
    const h = resolveBookingHandoff({ ...args, provider: 'lyft' });
    expect(h!.kind).toBe('GENERIC');
    expect(h!.url).toBe('https://ride.lyft.com/');
  });
});

describe('Curb and Empower handoffs', () => {
  it('are generic and say exactly why', () => {
    withEnv({ NODE_ENV: 'development' });
    for (const provider of ['curb', 'empower'] as const) {
      const h = resolveBookingHandoff({ ...args, provider });
      expect(h!.kind).toBe('GENERIC');
      expect(h!.prefillVerification).toBe('NOT_APPLICABLE');
      expect(h!.note).toMatch(/does not publish a deep-link format/i);
      expect(requiresInterstitial(h!)).toBe(true);
    }
  });
});

describe('source-supplied booking URLs', () => {
  it('are used when they pass the allowlist', () => {
    withEnv({ NODE_ENV: 'development' });
    const h = resolveBookingHandoff({
      ...args,
      provider: 'curb',
      sourceSuppliedUrl: 'https://gocurb.com/book/abc123',
    });
    expect(h!.kind).toBe('PARTIAL_DEEPLINK');
    expect(h!.url).toBe('https://gocurb.com/book/abc123');
    // We do not claim to know what a partner link prefills.
    expect(h!.prefillVerification).toBe('UNVERIFIED');
  });

  it('are discarded silently when they fail the allowlist', () => {
    withEnv({ NODE_ENV: 'development' });
    const h = resolveBookingHandoff({
      ...args,
      provider: 'curb',
      sourceSuppliedUrl: 'https://attacker.example/steal',
    });
    expect(h!.url).toBe('https://gocurb.com/');
    expect(h!.kind).toBe('GENERIC');
  });

  it('cannot be used to redirect one provider to another provider domain', () => {
    withEnv({ NODE_ENV: 'development', UBER_DEEPLINK_CLIENT_ID: 'c' });
    const h = resolveBookingHandoff({
      ...args,
      provider: 'uber',
      sourceSuppliedUrl: 'https://lyft.com/ride?id=lyft',
    });
    expect(new URL(h!.url as string).hostname).toBe('m.uber.com');
  });
});
