# Architecture

## The shape of the problem

A ride comparison is only meaningful if every provider prices **the same trip at
the same moment**. Almost every way this product goes wrong is a violation of
that sentence:

- geocoding the address separately per provider, so Uber prices a pickup 80 m
  from Lyft's;
- fetching serially, so the last provider is quoting a market 6 seconds older;
- collapsing a range to a midpoint, so a $20–40 band beats a firm $25;
- letting one slow provider stall or fail the whole comparison;
- serving a cached price from a different user's linked account.

The architecture is organised around preventing each of these structurally
rather than by discipline.

## Chain

```
USER
  ↓  pickup + destination
LOCATION NORMALIZER            one geocoder, one resolve, one coordinate pair
  ↓  CanonicalRoute
QUOTE SESSION                  id, status, coverage
  ↓
SOURCE REGISTRY                which authorized feeds are enabled right now?
  ↓
PARALLEL LIVE FETCH            Promise.allSettled, per-source deadline
  ↓
SCHEMA VALIDATION              Zod, inside each adapter
  ↓
PROVIDER NORMALIZATION         provider ids, integer money, seconds, metres
  ↓
PRODUCT NORMALIZATION          central taxonomy, unknown ⇒ OTHER
  ↓
SOURCE RECONCILIATION          one row per product, discrepancies recorded
  ↓
QUOTE SEMANTICS                upfront / estimate / range / metered
  ↓
FRESHNESS                      live / recent / stale / expired, at read time
  ↓
RANKING ENGINE                 uncertainty-aware; filters; fastest; best value
  ↓
RIDE RESULTS                   streamed to the client as each source lands
  ↓
VERIFIED BOOKING HANDOFF       allowlist-validated, server-issued URL
  ↓
PROVIDER APP / WEB             rider confirms the real fare and books
```

## Source vs provider

The distinction the whole system rests on:

- A **source** is where bytes come from — Obi, a direct partner API, a fixture.
- A **provider** is the brand a rider books — Uber, Lyft, Empower, Curb.

One source yields many providers; one provider can arrive from many sources.
Keeping them apart is what makes reconciliation, honest provenance and
per-source failure isolation possible. `SourceId` and `ProviderId` are separate
types and are never conflated.

## Source abstraction

```ts
interface QuoteSource {
  capabilities(): SourceCapabilities; // static facts + declared features
  enablement(): SourceEnablement; // evaluated per request from config
  getQuotes(req: QuoteRequest): Promise<SourceQuoteResult>;
  healthCheck(): Promise<SourceHealth>;
}
```

`enablement()` is evaluated per request, not cached at construction, so adding a
credential activates a source with an env change alone. It returns a
`BlockerCode` — `MISSING_CREDENTIAL`, `PARTNER_APPROVAL_REQUIRED`,
`POLICY_PROHIBITED`, `NO_PUBLIC_ENDPOINT`, `NON_PRODUCTION_ONLY` — because those
mean different things to an operator: one is a form to fill in, one is a contract
to sign, one is a legal boundary, one means no amount of configuration will help.

`SourceCapabilities` declares `supportsPrice`, `supportsUpfront`, `supportsETA`,
`supportsBooking`, `supportsAccountLink`, `supportsCurrentLocation`,
`supportsScheduledRide`, `markets`, `cacheTtlSeconds` and `rateLimit`. The UI
reads these rather than hard-coding "Empower has no upfront price" in a
component.

### Registered sources

| Source                         | Method               | Providers                        | Default                 |
| ------------------------------ | -------------------- | -------------------------------- | ----------------------- |
| `ObiQuoteSource`               | `AGGREGATOR_API`     | uber, lyft, empower, curb, waymo | needs `OBI_API_KEY`     |
| `CurbFlowQuoteSource`          | `DIRECT_PARTNER_API` | curb                             | needs `CURB_API_KEY`    |
| `UberAuthorizedQuoteSource`    | `DIRECT_PARTNER_API` | uber                             | **policy-gated off**    |
| `LyftAuthorizedQuoteSource`    | `DIRECT_PARTNER_API` | lyft                             | no public endpoint      |
| `EmpowerAuthorizedQuoteSource` | `DIRECT_PARTNER_API` | empower                          | no public endpoint      |
| `DemoQuoteSource`              | `LOCAL_FIXTURE`      | all four                         | **non-production only** |

See `docs/DATA_SOURCE_MATRIX.md` for why each is where it is.

## Regulated fares

`PublicRateCardQuoteSource` is the only source that produces a live price with
no credential, because a licensed taxi's fare is public data rather than a
commercial secret. It composes two things RideLens already has:

```
published rate card  ─┐
                      ├─▶ computeFare() ─▶ NormalizedQuote
measured route  ──────┘
```

The rate cards live in one file with `authority`, `sourceUrl` and `verifiedOn`
per market. The engine (`domain/tariff.ts`) is pure and integer-only: given a
card, a distance, a duration and a clock, it returns a fare with an itemised
breakdown. Surcharge windows are evaluated in the **market's** timezone, so a
4pm rush surcharge means the city's 4pm.

Zone tests — congestion surcharges, airport flat fares — are point-in-polygon
and point-in-circle against geometry declared on the card.

Distance is billed in **metres**, not miles. Converting to miles first and
dividing there let float error push an exact unit boundary just past an integer,
and `ceil` then charged a whole extra unit: measured across 1,600 exact
boundaries in the shipped cards, the naive form overcharged on 801 of them.
`meterUnits()` works in metres with a two-metre tolerance, which absorbs the
rounding while staying far below the smallest real unit (1/9 mile ≈ 179 m).

The output splits cleanly by certainty: an airport flat fare is an
`UPFRONT_QUOTE` because the regulator fixed it, and a metered fare is a
`METERED_ESTIMATE` band because traffic is unobservable. See
`docs/QUOTE_SEMANTICS.md` §"Regulated fares".

## The fare clock

`fareOutlook()` prices the same measured route at every upcoming boundary in the
tariff — the edges of each time window, plus midnight where a surcharge is
weekday-only. A regulated fare can only change at one of those minutes, so
evaluating each covers the day exactly, with no sampling and no drift.

Two things make it safe:

- it calls `computeFare` rather than reimplementing any of it, so a projection
  can never disagree with the price the engine would actually produce; and
- it re-reads the local time of each candidate instant and corrects the residual,
  so a DST transition shifts the label to the truth about the instant priced
  instead of silently reporting a clock time an hour off.

`sampleFareDay()` takes the same idea across the next 24 hours, for anything
priced by a published rule — a railroad's peak windows as readily as a taxi's
surcharges. `fareBands()` collapses the samples into the handful of distinct
prices a person would actually describe, and every band's `toOffset` is the
moment the price _changes_, which is the next band's start rather than its own
last sample. That distinction is the difference between "peak ends at 19:30" and
the truth, which is 20:00.

**It runs forward from now, not around a clock face.** Sampling "the next 03:30,
the next 04:00, …" and laying the results on a midnight-to-midnight axis splices
two days together: the hours after now come from today, the hours before it from
tomorrow. Most of the week that is invisible. On a Friday evening, or on a
public holiday, it is a lie — New York's rush-hour surcharge is weekdays
excluding holidays, so on Labor Day the strip showed a 4pm surcharge nobody
would be charged, contradicting the quote beside it. Offsets from now are
elapsed minutes, so every sample is a real instant in the rider's future and the
day turns over where it should. Labels are read back off that instant, which
also makes them correct across a DST transition.

Rail contributes `railFareBoundaries()` for the part that is specific to a
railroad: peak is defined at the terminal, so an outbound fare changes at the
window edge but an inbound one changes when the rider _boards_, which is the run
time earlier.

`src/domain/departure.ts` turns those bands into the one thing worth saying
about timing, and `DeparturePlanner` draws every option on a shared axis. The
metadata keys are the only contract, so a source that publishes no rule simply
shows nothing — which is what Metra does, and correctly.

## Journeys, and their two ends

`src/domain/journey.ts` is the only place this product decides how long a trip
takes. A railroad publishes a platform-to-platform run and a bike operator
publishes a door-to-door one; presenting both as "the trip duration" is what
let the Loop→O'Hare card claim 37 minutes for a journey with a 22-minute walk
at one end and 3.4 km of nothing at the other.

`buildJourney(board, ride, alight)` returns a `Journey` whose `totalSeconds` is
**null unless every leg is known and walkable**. Null is a refusal, not a
missing value. `gap` records which end defeated it, and the three cases are
distinguished because they are different problems for the rider: a station you
cannot walk _to_ still gets you there, one you cannot walk _from_ does not, and
`arrivesAtDestination()` is what the verdict consults before it is allowed to
use the word "less".

`journeyOf(quote)` reconciles the two vocabularies the sources grew
independently (`boardStation`/`alightStation` against `startStation`/
`endStation`) in one place. A bike is the special case: its published duration
already spans both walks, so its ride leg is computed as the remainder and the
total comes back to exactly the operator's figure rather than counting the
walks twice.

`journeySegments()` and `journeyLine()` are both **leg-driven rather than
gap-driven**. An earlier cut asked the single `gap` value which end was the
problem, and when the answer was "both" it reported only the far one — caught by
the live suite on a Scarsdale side street, not by eye.

Walking itself lives in `src/location/walking.ts`, deliberately separate from
`routing.ts`: the OSRM demo server that answers road routes has only the car
profile loaded and returns driving times for a walking request. See the header
comment there for the measurements. Walks are cached for six hours with
in-flight deduplication, because a footpath is not a fare.

## The cross-mode verdict

`src/domain/verdict.ts` is the one place the product compares across the
ranking boundary. Other modes are deliberately kept out of the ride ranking —
a shared bike would win "cheapest ride" on almost every trip and silently turn
a ride comparison into a mode comparison — but excluding a mode from a ranking
is not a reason to leave the rider to spot it.

`tripVerdict(ranked, otherModes)` returns the cheapest bookable option on each
side and the difference, or `null`. It returns `null` far more often than not:
when the car is already cheapest, when the currencies differ (the difference of
two numbers in different money is a category error, not a saving), when either
side has nothing bookable, and when the saving is under a fifth of the car
fare. `isBookable` is applied to **both** sides — filtering only the car once
allowed an empty docking station to be announced as the cheapest way to travel.

What it may claim is bounded by what the sources actually measure. Price,
freely: both fares are for the same two points. Never interchangeability — a
train leaves from a station, so the verdict carries `boardStation` and
`boardAccessMeters` and the UI states them in the same breath as the saving.
And never a saving between unlike journeys: `arrives` is false when the winner
stops short of the destination, and the bar then states both prices and the
distance not covered rather than subtracting them. The road figure is only ever
set against a `Journey.totalSeconds`, which by construction counts every leg.

## Scheduled departures

`QuoteRequest.departAt` asks a source to price a future instant instead of now.
It is honoured only where the price is a published rule: `computeFare` and
`priceRailTrip` already took an arbitrary instant, so the change is which one
they are given. Everything downstream of that — the outlook, the day chart —
reads the same `at`, so the fare and the chart can never end up describing
different moments.

Three things follow, and each is a claim the interface may no longer make:

- `NormalizedQuote.scheduledFor` marks the quote as a projection. The card
  says **Scheduled fare** rather than "live", and the pulsing dot goes.
- `expiresAt` becomes null. A rule will say the same thing in an hour, so a
  two-minute expiry would grey the card out and offer a Refresh that could only
  return the identical number.
- Auto-refresh is suppressed, for the same reason.

`departAt` is part of the cache key: a fare for next Tuesday and a fare for now
are different answers to different questions and must never be served for one
another. Sources that read live state decline outright — `BikeShareQuoteSource`
returns no quotes and a reason, without spending an upstream call to discover
it.

The horizon is capped in `CompareRequestSchema` at 30 days. A projection is
only as good as the rate card behind it, and a tariff is changed by rulemaking.

## Spacing and colour are tokens, and that is enforced

Every gap, pad and margin in `src/ui` is a `--sp-*` token, every radius an
`--r-*`, every text colour a `--text-*`. Not as a style preference: before this
the components used 3, 5, 6, 7, 9, 10, 11, 14 and 18px alongside the scale —
sixty values off-grid, each individually defensible and collectively the reason
the interface read as _almost_ aligned.

Three tests hold the line, because a convention nobody checks is a convention
that decays:

- `tokens.test.ts` — every `var(--x)` resolves, no raw spacing number, no raw
  radius, every palette colour redefined for dark.
- `contrast.test.ts` — every text token clears 4.5:1 on every surface it can
  appear on, in both schemes, with a visible step between the muted levels.
- `scripts/align-audit.mjs` — sibling blocks in a column whose edges differ by
  one to six pixels. Equal is fine and far apart is fine; it is the near miss
  that is never deliberate.

Zero and negative values stay raw. Zero needs no token, and a negative margin is
an optical correction — a control pulled back onto a line it would otherwise sit
below — which is deliberate, not spacing.

## What loads before the form works

Measured with `scripts/perf-audit.mjs`, which reports bytes on the critical
path rather than bundle totals on disk — the two are not the same number, and
only one of them is what a visitor waits for.

The map is loaded when it is needed, not when the page is. It brings MapLibre
and a 69KB stylesheet with it, and it does not exist until a comparison has run;
putting it on the critical path charges every visitor for something most have
not asked for yet. `next/dynamic` with `ssr: false` (MapLibre needs a real
canvas), and the loading placeholder holds the map's exact height so nothing
below it jumps.

Moving `maplibre-gl.css` out of `globals.css` and into `RouteMap.tsx` took CSS
on first paint from **86KB to 18KB**. The remaining JavaScript is almost
entirely the Next runtime; RideLens's own code is a small fraction of it.

## Why the map is toned with paint properties

The basemap has to recede in dark mode, and there are three ways to do it. Two
of them are wrong here, and both were tried:

- **A CSS filter on `.maplibregl-canvas`** gives a genuinely dark map — the rule
  was `invert(0.9) hue-rotate(180deg)` — but the route, its casing and the
  station dots are drawn into that same canvas, not above it. It was silently
  recolouring all of them: a casing set to near-black rendered pale, and the
  brand green arrived as something else.
- **A MapLibre `background` layer** inserted above the raster does nothing.
  Background layers always paint at the very bottom, whatever their position in
  the layer array.

`raster-opacity`, `raster-saturation` and `raster-contrast` reach the tile layer
alone, which is the only mechanism that pushes the map back without taking the
overlay with it. `applyTone` owns all three plus the casing colour, so a live
theme switch updates them together.

## Regional rail

A rate card only governs trips that _start_ in its city, so the entire commuter
shed had no price at all. `RegionalRailQuoteSource` fills that with the thing
that does publish one: the railroad's own fare table.

Operators publish two shapes of table, and `RailFares` is a discriminated union
over both rather than one shape bent to fit the other:

```
TO_TERMINAL (Metro-North)          ZONE_PAIR (Metra)
  one end must be a terminal         any station to any station
  outer station's zone → fare        (zoneA, zoneB) → fare
  peak / off-peak windows            one fare, all day
```

`planRailTrip` matches endpoints to stations and refuses, with the reason, when
it cannot: a trip too short to be a railroad journey, access legs longer than
the trip itself, both ends in town, a station pair no single line connects, or a
station the timetable serves a handful of times a day. `priceRailTrip` then
reads the fare and multiplies by the party, because each rider buys a ticket.

Peak is a property of the train, not of the clock at the ticket machine: inbound
it is the arrival time at the terminal, outbound the departure from it. When the
boarding horizon straddles a peak boundary the quote becomes the band between
the two published fares and never a number in between.

Fares are transcribed with a `verifiedOn` date. Station geometry — coordinates,
zone, line membership, run time, how many times the timetable calls there —
comes from the operator's GTFS. The split is deliberate: feeds carry fare files
and they go stale, and Metra's is two years behind its own live fare page.

Rail carries category `TRANSIT` and shares the _Other ways to get there_ band
with bikes, for the same reason bikes are there.

## Shared bikes

`BikeShareQuoteSource` reads GBFS, an open standard published so trip planners
can consume a bike system's live state. It is the only source in RideLens whose
data genuinely changes minute to minute.

```
discovery doc ─▶ station_information ─┐
              ─▶ station_status ──────┼─▶ planBikeTrip ─▶ priceBikeTrip
              ─▶ system_pricing_plans ┘        ▲
                       routed distance ────────┘
```

The trip is only priced if `planBikeTrip` can name a station with a bike and
another with a free dock, each within a short walk. That grounding is what makes
the quote honest: the pickup ETA is a real walk to a real station, and
availability tracks that station's live count.

Bikes carry category `BIKE` and the UI renders them in a separate band. A mode
that is almost always cheapest would otherwise win "cheapest ride" and silently
turn a ride comparison into a mode comparison.

Several operators redirect a branded discovery URL to a shared host. The HTTP
client re-validates every redirect target, so each system declares the hosts its
feeds may legitimately use rather than the client following redirects blindly.

## Location architecture

**One geocoder per deployment, one resolve per endpoint.** `createGeocoder()`
returns exactly one implementation; `canonicalizeRoute()` resolves pickup first,
then biases the destination lookup toward it, and produces one
`CanonicalLocation` pair that every adapter receives verbatim.

`CanonicalLocation` carries `lat`, `lng`, `formattedAddress`, `placeId`, `name`,
`city`, `region`, `country` and `geocoder` — the last so a session record shows
which provider resolved it.

Route sanity is enforced once: same-point (< 50 m), too-far (> 500 km) and
cross-border routes are rejected with specific codes rather than sent to
providers that will reject them anyway.

## Resilience: three layers in front of every upstream call

Ordered cheapest-first, so a healthy path never pays for the guards:

1. **Cache** — a recent identical answer (§Caching).
2. **In-flight coalescing** — `InFlightRegistry` keyed by the same cache key.
   Two riders searching the same route in the same second cost one upstream
   call; the second joins the first rather than racing it. Rejections are
   shared too, because it is genuinely the same call.
3. **Circuit breaker** — per source, trips after 4 consecutive failures inside
   a 2-minute window, stays open for 30 s, then admits exactly one probe.

The breaker exists because a provider that is down does not become healthy
because we keep asking. Without it, every comparison pays that source's full
8-second timeout, and once a paid contract exists, burns quota on calls that
cannot succeed. It is deliberately **not** tripped by a source being disabled
(configuration, not failure) or returning zero quotes (a real answer meaning
"nothing here").

A **session-level deadline** sits above the per-source ones as belt and braces:
an adapter that never settles cannot hold a stream open.

## Parallel fetch

Every enabled source is dispatched in one `Promise.allSettled`, each with its
own deadline (`QUOTE_REQUEST_TIMEOUT_MS`) enforced both by the orchestrator and
inside the HTTP client. `runOneSource` catches everything, so a rejection can
never escape into the session. Within an adapter, independent calls are also
concurrent — Uber's price and ETA endpoints are one `Promise.all`, never
sequential.

A failed source contributes a `SourceOutcome` with `quoteCount: 0`. It never
contributes substitute values. `tests/integration/engine.test.ts` asserts that
when Obi times out and Curb succeeds, the session is `PARTIAL`, Curb's quotes
render, and Uber/Lyft/Empower are absent rather than estimated.

## Streaming

`POST /api/quotes/stream` returns newline-delimited JSON:

```
{"type":"session",  ...}   route + providers to skeleton
{"type":"source",   ...}   one per source as it settles (may be an error)
{"type":"complete", ...}   reconciled, ranked, final
```

**Why NDJSON over a POST body rather than SSE or Realtime.** `EventSource`
cannot POST, so SSE would mean stashing the route in a session first — two round
trips and shared state for a stream that lives four seconds. Supabase Realtime
would add a broker to the critical path of the product's core interaction. Plain
`fetch` streaming needs no extra infrastructure, needs no session storage, and
degrades to an ordinary response body if the client cannot stream. It is the
simplest thing that reliably delivers each provider the moment it lands.

## Route geometry

The map draws a road-following path from a keyless routing service, fetched
**after** results are on screen — the map is context, and a slow routing
service must never delay a fare.

Everything it returns is tagged `MAP_ESTIMATE`, stored on the session rather
than on any quote, and rendered with an explicit "map estimate" label. A
quote's `tripDurationSeconds` is only ever the provider's own number. When
routing fails, the map falls back to a dashed straight line — dashed precisely
so it reads as a schematic rather than a route.

## Share links

Sharing a comparison collides with the privacy rule that coordinates never
appear in a URL (`docs/SECURITY.md`). The resolution: a share link carries an
**opaque 12-character id**, the route lives server-side in `shared_routes`, and
a row is created only by an explicit Share press.

Opening `/s/<id>` resolves the route and immediately runs a **fresh**
comparison. No price is ever stored in a share, because a fare from an hour ago
is a memory, not a price. Rows expire after 30 days so shared location history
does not accrete.

## Reconciliation

Duplicate `(provider, category, normalised product name)` groups collapse to one
canonical quote by a deterministic tier ladder:

1. price type — `UPFRONT_QUOTE` beats `ESTIMATE`
2. account context — `ACCOUNT_LINKED` beats `PUBLIC`
3. availability — bookable beats unbookable
4. source authorization — direct partner beats aggregator beats fixture
5. freshness — newer observation of the same market
6. presence of a booking handoff

**Two sources' prices are never averaged.** An average is a number no provider
will honour. Every candidate is retained in `session.candidates` for debugging,
and every disagreement becomes a `SourceDiscrepancy` with a basis-point spread.
Above 1000 bps the card shows _"Price may have changed — confirm in the provider
app"_ — the authoritative number, plus the truth that only the provider app can
settle it.

## Caching

A short-TTL optimisation, never a substitute for a live fetch.

- Key: `source : accountScope : locale : pickup → destination`, coordinates
  quantised to 4 dp (~11 m — close enough that the fare is unchanged).
- **`ACCOUNT_LINKED` results are never written to the shared cache.**
- TTL is per source, from `capabilities().cacheTtlSeconds`; `0` disables caching
  for that source entirely.
- The Refresh button sets `forceRefresh`, bypassing the cache.

## Persistence

Supabase (Postgres) with RLS; an in-memory repository for local development that
production refuses to boot on. **Persistence never blocks a response** —
`persistInBackground` fires and forgets, so a database outage degrades RideLens
to "comparison works, history does not", which is the right trade for a utility
whose value is the live comparison.

`quote_sessions` stores **coarse** coordinates only: `numeric(6,2)` cannot
physically hold a precise coordinate, so the schema enforces the privacy rule
rather than trusting the application to.

`getSession()` deliberately does not rehydrate a stored session into a live
result. A stored session is an audit record, not a price; re-running the
comparison is the only correct way to see current prices.

## Configuration

`loadConfig()` validates the whole environment with Zod and derives:

- `demoSourceActive` = `RIDELENS_DEMO_SOURCE === 'enabled' && !isProduction` —
  **a production build cannot serve fixture data**, and `GEOCODER_PROVIDER=fixture`
  throws outright in production;
- `geocoderProvider`, `persistence`, `rateLimiter` — resolved once from what is
  actually configured.

`startupChecks()` runs at boot and is exposed on `/api/health`. A production
deployment with no live source, no durable persistence, or no durable rate
limiter reports `error`.

## Security boundaries

- All outbound HTTP goes through `httpJson`: HTTPS-only, per-call host
  allowlist, manual redirect handling that re-validates the target host, bounded
  response size, timeout.
- **A URL inside a provider payload is untrusted.** It is validated against the
  provider's booking allowlist by exact host match before it can reach a client,
  and the client posts booking intent to `/api/handoff` for server-side
  re-validation rather than navigating to a payload URL directly.
- Logs are redacted structurally: credentials by key name, coordinates and
  addresses by key and by regex on free text.

Full detail in `docs/SECURITY.md`.

## Rate limiting and cost control

Fixed-window limiting on a hashed client identifier — never a raw IP, never a
client timer. Upstash Redis, then Supabase, then in-memory (refused in
production). Separate buckets for `compare`, `geocode`, `handoff` and `admin`,
because autocomplete legitimately fires far more often than a comparison.

Vehicle capacity is RideLens's own model, not provider data — no source in
scope reports seat counts — so `domain/capacity` labels it as such everywhere
and filters conservatively: it would rather hide an option than seat five
people in a four-seat car.

Per-source counters (calls, cache hits, errors, timeouts, p50/p95, success rate)
feed `/admin` and `/api/admin/usage`. These live in an in-process registry, so
on a multi-worker or serverless runtime each worker reports only its own share —
`api_usage_daily` is the complete record. Estimated cost is modelled from a
configurable per-call rate and is labelled an estimate everywhere it appears.

## Deployment

Next.js App Router on Node. All routes are `force-dynamic`: a cached comparison
page would be the opposite of the product. Security headers, including a CSP
that permits no third-party script origins, are set in `next.config.ts`.

Error boundaries at both route and root level ensure a render fault never
blanks the page — and say explicitly that the failure was RideLens's, not a
provider's price, so nobody walks away thinking a provider was expensive when
the truth was that the app broke.

The CSP relaxes **only in development**, where React's dev build needs `eval()`
and HMR needs a WebSocket; without them client components never hydrate.
Production keeps the strict policy.
