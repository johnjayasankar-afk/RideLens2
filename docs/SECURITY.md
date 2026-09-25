# Security

## Principles

- Authorized data only — no scraping, captcha bypass, token theft, or private endpoint reverse engineering
- Treat all external payloads as untrusted (Zod validation)
- Never render HTML from providers
- Never server-fetch arbitrary provider-returned URLs
- Booking URLs allowlisted by host
- No open redirects

## Secrets

Provider keys and Supabase service role stay server-side. `.env.example` documents names only.

## OAuth (account linking)

When enabled later: PKCE, state verification, encrypted token storage, refresh, revocation, disconnect. Tokens never exposed to the browser beyond the OAuth exchange.

## Location privacy

- Do not request geolocation until user action
- Do not put precise coordinates in generic analytics
- Minimize logging; prefer coarse diagnostics
- Authenticated recent searches deletable via profile controls (schema ready)

## Rate limiting

Server-side sliding window on compare / places / book. Client timers are not trusted.

## Cache isolation

Account-linked quotes never stored under public cache keys.

## RLS

Supabase migrations enable RLS on user-owned tables. Service role used only on server.

## Uber compliance

Uber Price Estimates API is **not** called for competitive comparison unless `UBER_COMPARISON_AUTHORIZED=true` under a written agreement. Public ToS § II B forbids competitive aggregation of Uber API data.

## Content Security Policy

**Enforcing**, with a per-request nonce, from `src/proxy.ts`. It cannot live in
`next.config.ts` because a nonce has to be generated per request and a static
header table cannot do that.

`script-src` carries **no `'unsafe-inline'`**. Next stamps the nonce onto its
own bootstrap and bundles by parsing the policy off the request headers, so
nothing inline runs without it.

Three things follow from that, and each has already broken something once:

- **A page must render dynamically to carry a nonce.** Anything prerendered at
  build time has none, so its own inline scripts are refused and React never
  hydrates. `/book` and `/_not-found` are `force-dynamic` for this reason and
  nothing else. `export const dynamic` has no effect inside a `"use client"`
  module, which is why `/book` is a server shell around a client component.
- **`style-src` keeps `'unsafe-inline'`.** React writes inline styles straight
  onto elements and they cannot carry a nonce.
- **`'strict-dynamic'` is deliberately absent.** It tells browsers to ignore
  `'self'`, which would refuse the app's own bundles on any page without a
  nonce.

### It shipped report-only, and had never been checked

The policy previously shipped as `Content-Security-Policy-Report-Only` with a
comment saying to flip it "once the console is quiet". Nobody had looked: a
single comparison produced **219 violations**. MapLibre fetches its style,
tile JSON, sprite sheet and glyph `.pbf` fonts over XHR — all `connect-src`,
none of which listed the CARTO hosts — and decodes tiles in a blob worker,
which needs `worker-src`. Enforcing it as written would have blanked the map.

Both directives are fixed, the console is genuinely quiet on `/`, `/sources`,
`/book`, `/admin` and a 404, and the policy now enforces.

**When adding a host, verify it against a real page load.** The evidence is a
browser console with no violations, not a plausible-looking directive.

## Third-party script

`route-map.tsx` loads MapLibre from `unpkg.com` and runs it on this origin.
It is pinned with subresource integrity derived from the npm registry's own
published tarball — `dist.integrity` verified against the downloaded bytes,
which are byte-identical to what the CDN serves — rather than from whatever
the CDN returned on the day. A mismatch makes the browser refuse the file and
the map degrades, which is the correct outcome.

It is not a `package.json` dependency, so `npm audit` does not see it and the
version is a string in a component file. See `docs/PERFORMANCE.md`.
