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
