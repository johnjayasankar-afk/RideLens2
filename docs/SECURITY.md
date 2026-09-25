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

## No third-party script

`script-src` is `'self'` plus a per-request nonce. Nothing else. There is no
CDN in the allowlist and no external origin can execute on this page.

MapLibre used to be injected from `unpkg.com` and read off `window`. It is now
`maplibre-gl` in `package.json`, lazily imported from the bundle. The
difference is not theoretical: **the moment it became a real dependency,
`npm audit` reported a critical XSS advisory** (GHSA-jrc7-96c5-q579, sanitizer
bypass in `DOM.sanitize()`) covering every version at or below 6.4.0 —
including the 4.7.1 the app had been serving to users. A CDN script is not
merely a supply-chain risk; it is one your tooling cannot see. Now on 6.11.2,
with `npm audit` clean.

Its tile-decoding worker is served from this origin too, vendored out of
`node_modules` at build time by `scripts/vendor-map-worker.ts` so it always
matches the installed version.

What remains third-party is map **tiles**, from CARTO. Those are `connect-src`
and `img-src` only, and they do tell CARTO the approximate area a rider is
looking at — a privacy fact worth knowing, recorded here rather than left
implicit.
