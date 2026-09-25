/**
 * Share links: creation, resolution, and the privacy property that motivates
 * the whole design — coordinates never appear in the URL.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRideLensEnv, withEnv } from '@tests/helpers';
import { resetShareStore } from '@/db/shareStore';

async function post(body: unknown, ip = '198.51.100.40') {
  const { POST } = await import('@/app/api/share/route');
  return POST(
    new Request('https://ridelens.test/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
  );
}

async function get(id: string, ip = '198.51.100.41') {
  const { GET } = await import('@/app/api/share/[id]/route');
  return GET(
    new Request(`https://ridelens.test/api/share/${id}`, {
      headers: { 'x-forwarded-for': ip },
    }),
    { params: Promise.resolve({ id }) },
  );
}

const ROUTE = {
  pickup: { kind: 'query', text: '14 Prince St' },
  destination: { kind: 'query', text: 'JFK' },
};

beforeEach(() => {
  clearRideLensEnv();
  withEnv({
    NODE_ENV: 'development',
    GEOCODER_PROVIDER: 'fixture',
    NEXT_PUBLIC_APP_URL: 'https://ridelens.test',
    RATE_LIMIT_MAX_REQUESTS: '500',
  });
  resetShareStore();
});
afterEach(() => {
  resetShareStore();
  clearRideLensEnv();
});

describe('POST /api/share', () => {
  it('returns an opaque id, and NO coordinates anywhere in the URL', async () => {
    const res = await post(ROUTE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; url: string; expiresAt: string };

    expect(body.url).toBe(`https://ridelens.test/s/${body.id}`);
    // The privacy property this design exists for.
    expect(body.url).not.toMatch(/40\.7|73\.9|lat|lng/i);
    expect(body.id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{12}$/);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('resolves back to the canonical route', async () => {
    const created = (await (await post(ROUTE)).json()) as { id: string };
    const res = await get(created.id);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      pickup: { name: string; lat: number };
      destination: { name: string };
    };
    expect(body.pickup.name).toBe('14 Prince St');
    expect(body.destination.name).toBe('JFK Terminal 4');
    expect(body.pickup.lat).toBeCloseTo(40.7233, 3);
  });

  it('never stores or replays a price', async () => {
    const created = (await (await post(ROUTE)).json()) as { id: string };
    const body = await (await get(created.id)).json();
    expect(JSON.stringify(body)).not.toMatch(/price|fare|minor|currency/i);
  });

  it('rejects an unresolvable route rather than minting a dead link', async () => {
    const res = await post({
      pickup: { kind: 'query', text: 'zzz nowhere zzz' },
      destination: { kind: 'query', text: 'JFK' },
    });
    expect(res.status).toBe(422);
  });

  it('rejects a malformed body', async () => {
    const res = await post({
      pickup: { kind: 'coords', lat: 900, lng: 0 },
      destination: ROUTE.destination,
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/share/:id', () => {
  it('404s an unknown id', async () => {
    const res = await get('abcdefghjkmn');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('NOT_FOUND');
  });

  it('rejects a malformed id without touching the store', async () => {
    const res = await get('../../../etc');
    expect(res.status).toBe(400);
  });

  it('marks a not-found as non-retryable so clients do not spin', async () => {
    const body = (await (await get('abcdefghjkmn')).json()) as { retryable: boolean };
    expect(body.retryable).toBe(false);
  });
});
