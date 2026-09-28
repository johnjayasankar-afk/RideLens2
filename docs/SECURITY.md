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

### The trip log

`src/lib/history/trip-log.ts` keeps a record of comparisons the rider has
run — the two endpoints, the date, and the price bands each provider showed.
It is the only place RideLens stores anything about a person's movements, so
the constraints are worth stating plainly:

- **It never leaves the device.** There is no endpoint that accepts it, no
  identifier attached to it, and nothing in the client that sends it. It lives
  in `localStorage` under `ridelens.trips`.
- **It is not needed.** Every read is wrapped; a blocked or cleared store
  renders as no history rather than as an error. Nothing on the page depends
  on it existing.
- **It expires.** Records older than `MAX_AGE_DAYS` are dropped on every read,
  not merely hidden, and the log is capped at `MAX_RECORDS`.
- **It is deletable without a menu.** Each route carries a forget control in
  the list itself, and `useTripLog().clear()` removes the key outright.

A list of somebody's regular movements is exactly the kind of thing people
assume has been uploaded. The UI says "On this device only" next to it rather
than waiting to be asked.

### Reported fares

A rider can say what a trip actually cost. Three things bound what that
means:

- **The answer is local first.** It is written to the trip log and nowhere
  else. Contributing it to the shared calibration corpus is a separate,
  explicit action, and the button says exactly what it sends.
- **What it sends carries no location.** The distance, the hour, the
  provider and product, the predicted band, the fare, and `routeHash` — a
  one-way digest of the route rounded to about 100 m. Not the addresses, and
  not the coordinates. `routeHash` used to be the rounded coordinates joined
  by colons, under a comment claiming it was not a location; it is a digest
  now, and a test asserts no coordinate fragment survives in it.
- **A prediction cannot be forged.** The claim is signed when the quote is
  made and verified on the way back in, so a client cannot post a flattering
  pair of numbers into the corpus. See `lib/eval/report-proof.ts`.
  `RIDELENS_REPORT_SECRET` must be set for late reporting to work at all.

### The assistant

A language model inside this product is a liability before it is a feature.
Every other honesty measure here exists to stop RideLens saying something it
cannot support, and one confidently invented fare undoes all of them. Four
things bound it:

- **It is given a brief, not a topic.** `lib/assistant/context.ts` builds the
  figures actually on the reader's screen — prices as the strings they are
  shown as, the named charges behind them, the rider's own record where there
  is enough of it — plus an explicit list of what is not known. The system
  prompt forbids stating any figure outside it, averaging a band, naming a
  winner on overlapping ranges, or calling a modelled estimate a live quote.
- **Money never reaches it as a number.** Every figure arrives pre-formatted
  ("$69.95 to 71.45"). A model handed minor units eventually divides by a
  hundred in prose; a model handed a band eventually averages it. Neither can
  happen to a string it is told to quote verbatim. Multipliers and weights are
  filtered out of the charge list for the same reason.
- **It cannot act, only propose.** The five tools map to things the rider can
  already do with one tap — refresh, swap, re-rank, filter, watch. The model
  returns an intent; the server validates it, the client validates it again,
  and then runs it through the same path the command palette uses. It cannot
  book, pay, send, share or delete, and a test asserts none of those words
  appear anywhere in the tool surface.
- **The key is server-side and nothing is kept.** `ANTHROPIC_API_KEY` is read
  in a route handler. The trip log arrives in the request body from the
  client and is never stored; no transcript is written. Unset, the assistant
  is hidden entirely rather than degraded.

Rate limited to 20 questions per five minutes per IP, tighter than the other
routes because each call costs real money.

### Price watches

`src/lib/history/price-watch.ts` stores a route and a threshold under
`ridelens.watches`, with the same constraints as the trip log — local, capped,
expiring, deletable.

The distinction worth writing down is what a watch _is_. The obvious shape of
the feature is a push notification, and that is the one thing it must not read
as: delivering one would mean a server polling a route on somebody's behalf,
which also means generating fares nobody asked for. A watch here is a standing
question answered when the reader next looks, and the only sentence allowed to
describe it is `WATCH_DISCLOSURE`:

> Checked when you open RideLens — nothing runs in the background and nothing
> is sent to you.

A unit test refuses that sentence if it ever contains "notify", "alert",
"push", "email" or "remind", and a Playwright test asserts it is on screen
beside the control rather than behind a disclosure triangle.

## Rate limiting

Server-side sliding window on compare / places / book. Client timers are not trusted.

### Every route, or a stated reason

`/api/walk` fans out to a public walking router — somebody else's server —
and shipped with no ceiling at all. Its own header argues that sixteen
speculative queries per comparison is not a reasonable thing to send, and
then left the number of comparisons unbounded. `/api/alternatives` was the
same, and `/api/forecast` had none either. Every endpoint written before
those three had a limit; the three added later did not, and nothing noticed.

`tests/unit/api-rate-limits.test.ts` now fails on any route that answers
without one. Three are exempt, each with its reason recorded in the test:
the health probe (rate-limiting a liveness check means an orchestrator can
be told the service is down for asking), the admin overview (behind
`RIDELENS_ADMIN_SECRET`, 401 before any work), and reading one already
computed session by its unguessable id. Anything that reaches outward,
spends money or writes is not exempt, and the list is checked in both
directions so it cannot stop describing the code.

Limits are proportional to what a call costs someone else: walk 20/min,
alternatives 40/min, forecast 60/min.

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
