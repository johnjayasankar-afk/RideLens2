# Security

## Authorized access only

RideLens queries providers only where access is legitimately available. This is
a hard boundary, not a preference, and it is enforced in code by the source
enablement gates.

**Never implemented, under any configuration:**

- CAPTCHA solving or bypass
- bot-detection evasion or fingerprint spoofing
- reverse-engineering private mobile endpoints
- use of stolen, borrowed or scraped bearer tokens
- session hijacking or credential harvesting
- certificate-pinning bypass
- rotating residential proxies to evade access controls
- automated account creation
- rate-limit evasion

Browser automation against a provider surface is **not** implemented. It would be
permissible only for a public quote surface whose terms and access controls
allow it, and no such surface has been identified for these providers. Nothing
in the codebase performs it, and there is no `PermittedBrowserQuoteSource`
shipped in an enabled state.

Third-party vendors selling scraped Uber or Lyft pricing are out of scope for
the same reason: their access is unauthorized, so consuming it would launder an
unauthorized access into RideLens.

Where a provider cannot legitimately be queried, its adapter reports a blocker
code and the provider is shown as unavailable. **We never fill the gap with an
estimate.**

### Why the two credential-free sources are inside the line

`PublicRateCardQuoteSource` produces live prices with no credential, and it is
worth being explicit that this is not a loophole:

- the tariffs are **published by the regulator** for the public to read;
- no provider system, endpoint, session or access control is touched;
- the only network calls are to a public geocoder and a public routing service,
  both used within their stated policies and with an identifying User-Agent;
- nothing is scraped, and no consumer surface is automated.

`BikeShareQuoteSource` reads GBFS, and the case is stronger still:

- GBFS exists **specifically** so third-party trip planners can read a system's
  live state; many cities require operators to publish it as a permit condition;
- the feeds are unauthenticated, uncredentialed and openly documented — reading
  them is the intended use, not a workaround for one;
- requests are plain `GET`s at the operator's own published TTL, identifying
  themselves, with nothing written and no session involved.

Note who runs most of these systems: Citi Bike, Divvy, Bay Wheels and
Bluebikes are Lyft's. So RideLens does show a live price sourced from Lyft's own
infrastructure — because Lyft publishes it for exactly this purpose. That is the
whole distinction. It is emphatically _not_ Lyft rideshare pricing, which stays
unavailable.

Redirects are the one sharp edge. Several operators redirect a branded discovery
URL to a shared host, and the client re-validates every hop against the
allowlist. The fix was to declare each system's legitimate redirect targets
alongside it, not to loosen the check — a guard relaxed to make one feed work
stops guarding everything else.

It is the difference between reading a price list posted on a wall and picking
a lock. It also does not extend to the others: there is no published Uber rate
card to compute from, and modelling one would be inventing a price, which the
product refuses to do.

## Location privacy

### Why the route is not in the URL

A reload used to empty both fields, and the obvious fix is query parameters.
They are the wrong mechanism here. A pickup and destination in the address bar
land in browser history, in the `Referer` of every outbound link, and in any
log that records a path — the share feature already answers "give me a link"
with an opaque id for exactly that reason, and putting the location back in the
URL would undo it.

The draft lives in `sessionStorage`: scoped to one tab, surviving a reload,
gone when the tab closes, never leaving the browser. It holds only the labels
the rider chose — the same ones already kept in recents — and never a price,
because a fare from ten minutes ago restored as current is the one thing this
product must not do. Clearing saved places clears it too, and an E2E test
asserts the URL contains neither coordinates nor place names.

Location is the most sensitive data RideLens touches, and the controls are
structural rather than procedural.

**Never requested before context.** Geolocation is requested only when the rider
presses "Use current location". The app does not prompt on load. Denial is a
normal path: search remains fully functional, and an E2E test asserts it.

**Never in generic analytics or logs.** `logger.redact()` replaces any `lat`,
`lng`, `latitude`, `longitude`, `formattedAddress` or `address` key with a
placeholder, and scrubs anything matching a decimal-coordinate pattern from free
text. The engine deliberately omits the route from `quote_session.start` — there
is no log line anywhere that carries a rider's coordinates.

**Coarsened at rest.** `quote_sessions` stores coordinates as `numeric(6,2)`
(~1 km). The column type makes precise storage impossible, so the schema enforces
the rule rather than trusting the application layer.

**Minimised retention.** `recent_searches` is the only table holding precise
coordinates, it belongs to a signed-in user, and its RLS policy grants that user
`ALL` — including `DELETE`. History deletion is a first-class capability.

**Not in URLs.** Routes are posted in a request body. Coordinates never appear
in a query string, where they would land in access logs, referer headers and
browser history.

`booking_handoff_events` stores the destination **host**, never the full booking
URL, because a prefilled deep link contains the rider's origin and destination.

## Share links

Sharing a route conflicts with "no coordinates in URLs", so the design resolves
it rather than trading it away:

- a share link is an **opaque 12-character id**; the coordinates live
  server-side in `shared_routes`;
- a row exists only because the rider pressed Share — nothing is stored by
  browsing;
- the id is drawn from 12 characters of a 32-symbol alphabet, far too large to
  enumerate, and excludes `i`, `l`, `o` and `u` so it survives being read aloud;
- **no price is ever stored**, so a share cannot replay a stale fare;
- rows expire after 30 days, and `purge_expired_shared_routes()` removes them;
- `shared_routes` has RLS enabled with **no client policies** and privileges
  revoked from `anon`/`authenticated` — a share id is a capability, and blanket
  SELECT would make the table enumerable;
- `/s/<id>` is marked `noindex`, because a share link points at someone's route.

## Booking links and open redirects

A URL arriving inside a provider payload is untrusted input. An unvalidated
`booking_url` is an open redirect that sends a rider — at the exact moment of
purchase intent — to whatever the payload says.

Two layers:

1. `resolveBookingHandoff` validates any source-supplied URL against that
   provider's allowlist. Failures are discarded silently and replaced with a
   URL RideLens constructed.
2. The client never navigates to a payload URL. It posts intent to
   `/api/handoff`, which re-validates server-side and returns the URL only if it
   passes.

Validation requires HTTPS, no embedded credentials, and an **exact** host match
against that provider's allowlist. Suffix matching is deliberately not used —
`m.uber.com.evil.tld` passes a naive `endsWith` check. Tests cover the lookalike
domain, the cross-provider swap, the credential-embedded URL and the
`javascript:` scheme.

## SSRF

All outbound HTTP goes through `httpJson`, which:

- refuses any non-HTTPS URL;
- takes a per-call host allowlist and refuses anything else;
- sets `redirect: 'manual'` and re-validates the target host against the same
  allowlist before following;
- caps buffered response size;
- enforces a timeout on every request.

**No code path fetches a URL that came from a provider payload.** Payload URLs
are only ever handed to the browser after allowlist validation.

## Provider payload validation

Every external response is parsed with Zod before it touches domain logic. A
schema failure raises `SourceError(kind: 'SCHEMA')` — the source fails, the
session goes `PARTIAL`, and nothing is invented. Unrecognised providers map to
`other`; unrecognised products map to `OTHER`. Neither is guessed into a
category that would put it in the cheapest comparison.

Nothing from a provider is rendered as HTML. React escapes all of it, and there
is no `dangerouslySetInnerHTML` in the codebase.

## Cross-user cache isolation

The cache key contains the account scope, and `ACCOUNT_LINKED` results are never
written to the shared cache at all. One rider's personalised Uber price cannot be
served to another. Pinned by tests in both `security.test.ts` and `engine.test.ts`.

## Rate limiting and abuse

Fixed-window limiting on a **hashed** client identifier — the raw IP is never
stored. Separate buckets for `compare`, `geocode`, `handoff` and `admin`.
Client-side timers are never trusted; the server is the only enforcement point.

Duplicate submits are debounced in `useCompareSession` (an in-flight guard), and
identical active searches share a cache entry, so a double-click cannot double-
spend an upstream call.

The Upstash limiter **fails open** on limiter unavailability, and records the
event. A broken limiter should not take the product down, but the operator must
be able to see that it happened.

## Secrets

- No secret is ever sent to the client. `NEXT_PUBLIC_*` holds only the app URL,
  the Supabase anon key and a map key.
- The Supabase service-role key is server-only; the admin dashboard reads
  operational tables through a server route, never from the browser.
- `logger.redact()` removes any key matching `key|token|secret|password|
authorization|credential|bearer|apikey`.
- `.env` and `.env*.local` are gitignored; `.env.example` carries no values.

## OAuth and stored tokens

Account linking is optional and **OAuth-only** — RideLens never asks a rider for
a provider password. The design, gated behind `TOKEN_ENCRYPTION_KEY`:

- Authorization Code with PKCE; `state` generated server-side, single-use, and
  verified on callback.
- Tokens encrypted with AES-256-GCM before storage. `connected_provider_accounts`
  holds only `access_token_enc` / `refresh_token_enc`; the database never sees
  plaintext.
- No client role can `INSERT` or `UPDATE` that table — tokens are written only
  by the service role after an exchange. Owners may `SELECT` (to render
  "Connected") and `DELETE` (to disconnect).
- Disconnect revokes upstream where the provider supports it, then deletes the
  row.

**Current status: disabled.** No provider in scope currently offers a usable
OAuth path for quote personalisation — Uber's requires a commercial agreement
that also settles the comparison-rights question, and Lyft's developer programme
is closed. The schema, RLS and the encryption boundary exist; the flows activate
with a credential.

## Row Level Security

Every table has RLS enabled. Rider-facing tables grant owner-only access; child
rows (`quotes`, `provider_requests`) check ownership through their parent
session.

Operational tables — `source_discrepancies`, `provider_health_events`,
`api_usage_daily`, `provider_configuration` — have **RLS enabled and no
policies**, so `anon` and `authenticated` can read nothing; only the service role
reaches them. Direct privileges are additionally revoked from both roles, so a
future permissive policy cannot silently open them.

Anonymous sessions carry `user_id IS NULL` and are readable only via the service
role, so one anonymous visitor cannot enumerate another's sessions.

## Transport and browser headers

Set in `next.config.ts`: HSTS with preload, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy:
strict-origin-when-cross-origin`, and `Permissions-Policy` granting geolocation
to self only while denying camera, microphone, payment and USB.

The CSP allows **no third-party script origins**. Map tiles are the only
external resource, and only from OSM/Carto tile hosts.

## Denial of service and cost abuse

Beyond rate limiting, three mechanisms bound what a hostile or merely
enthusiastic client can cost:

- **In-flight coalescing** collapses identical concurrent searches into one
  upstream call, so a burst of duplicate requests cannot multiply spend.
- **The circuit breaker** stops calling a failing source entirely, which
  matters most under a paid contract: a provider outage otherwise turns every
  search into a billable failure.
- **Auto-refresh is bounded** — opt-in, paused when the tab is hidden, and
  hard-stopped after 12 cycles, so a forgotten tab cannot poll all day.

## Production safety checks

`startupChecks()` reports as `error`, on `/api/health` and `/admin`:

| Code                        | Condition                                                      |
| --------------------------- | -------------------------------------------------------------- |
| `DEMO_SOURCE_IN_PRODUCTION` | fixture flag set in a production build (ignored, and reported) |
| `NO_LIVE_QUOTE_SOURCE`      | production with no authorized source                           |
| `NO_DURABLE_PERSISTENCE`    | production on in-memory storage                                |
| `NO_DURABLE_RATE_LIMITER`   | production on an in-memory limiter                             |

`GEOCODER_PROVIDER=fixture` throws at config load in production rather than
being reported.

## Review status

Reviewed against this document on 2026-09-03. RLS, allowlist, redaction, cache
isolation, SSRF containment and the rate limiter are covered by automated tests.
OAuth token encryption is **designed and schema-backed but not exercised**, since
no provider credential exists to run it against — it must be re-reviewed before
account linking is enabled.
