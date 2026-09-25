# RideLens

**Every ride. One live comparison.**

Enter where you are and where you are going. RideLens fetches the freshest
legitimately accessible live prices and pickup ETAs across competing ride
providers, normalises them, compares equivalent ride types, ranks them honestly,
and hands you into the provider's own booking flow.

---

## Current provider status

**Verified 2026-09-03.** Full detail and citations in
[`docs/DATA_SOURCE_MATRIX.md`](docs/DATA_SOURCE_MATRIX.md).

| Provider      | Source                   | Status                                 | Blocker                                                         |
| ------------- | ------------------------ | -------------------------------------- | --------------------------------------------------------------- |
| Uber          | Obi Intelligent Pricing  | Adapter complete, disabled             | `PARTNER_APPROVAL_REQUIRED` — Obi commercial agreement          |
| Uber          | Uber Rides API (direct)  | Adapter complete, **policy-gated off** | `POLICY_PROHIBITED` — API ToU §II B bars competitive comparison |
| Lyft          | Obi Intelligent Pricing  | Adapter complete, disabled             | `PARTNER_APPROVAL_REQUIRED`                                     |
| Lyft          | Lyft Public API (direct) | Adapter complete, disabled             | `NO_PUBLIC_ENDPOINT` — developer programme closed               |
| Empower       | Obi Intelligent Pricing  | Adapter complete, disabled             | `PARTNER_APPROVAL_REQUIRED`                                     |
| Empower       | Empower partner API      | Adapter complete, disabled             | `NO_PUBLIC_ENDPOINT` — no published programme                   |
| Curb          | Curb Flow (direct)       | Adapter complete, disabled             | `PARTNER_APPROVAL_REQUIRED` — Curb partner agreement            |
| Waymo         | Obi Intelligent Pricing  | Adapter complete, disabled             | `PARTNER_APPROVAL_REQUIRED`                                     |
| **Geocoding** | Nominatim + Photon (OSM) | **LIVE VERIFIED**                      | none — keyless                                                  |

**No live quote source is currently connected**, and RideLens says so rather
than pretending: the home page shows the specific blocker, `/api/health` reports
`liveDataAvailable: false`, and `POST /api/quotes` returns
`503 NO_SOURCE_CONFIGURED`. **No fixture data is ever substituted for a missing
source.**

The single highest-value unblock is an Obi agreement — it turns on Uber, Lyft,
Empower, Curb and Waymo at once, and it is the only lawful route to Uber and
Lyft coverage. See [`SETUP_REQUIRED.md`](SETUP_REQUIRED.md).

---

## What it does

|                               |                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Live comparison**           | The same two points go to every connected provider, in parallel, with per-source deadlines.                                              |
| **Honest labels**             | Every quote carries its price type, freshness and account context, end to end. A range stays a range.                                    |
| **Uncertainty-aware ranking** | An exact $25 and a $20–40 estimate are compared as intervals, not by their low ends.                                                     |
| **Ride detail**               | Every card opens a panel showing the source, confidence, timestamps, expiry, prefill status, and the candidates reconciliation rejected. |
| **Share links**               | An opaque link with no coordinates and no prices. Opening it runs a _fresh_ comparison.                                                  |
| **Fare splitting**            | Whole-cent splits between up to eight people that always add back to the total exactly.                                                  |
| **Passenger filtering**       | Filters to vehicles that seat the group, with capacity labelled as a RideLens model.                                                     |
| **Auto-refresh**              | Opt-in, paused when the tab is hidden, hard-stopped after 12 cycles, countdown shown.                                                    |
| **Price movement**            | A session-scoped sparkline of the cheapest bookable price across refreshes.                                                              |
| **Saved places**              | Home, Work and recent routes as quick picks — stored only in the browser, no fare attached.                                              |
| **Road route map**            | A road-following path, labelled a map estimate and never mixed with provider trip data.                                                  |
| **Keyboard**                  | `/` or `⌘K` to search, `R` to refresh, `?` for help, `Esc` to close.                                                                     |
| **Operator view**             | Per-source health, blocker codes, latency percentiles and modelled cost at `/admin`.                                                     |

## Quick start

```bash
npm install
cp .env.example .env.local     # optional — RideLens runs with nothing set
npm run dev                    # http://localhost:3000
```

With no credentials at all you get **live regulated taxi fares** in New York,
Chicago, Washington DC and San Francisco, plus a live geocoder and route map.
Every market-priced provider reports its blocker instead of inventing a number.

To see the full multi-provider UI with deterministic data:

```bash
RIDELENS_DEMO_SOURCE=enabled GEOCODER_PROVIDER=fixture npm run dev
```

Both flags are **ignored in production** — see _Mock safety_ below.

---

## Architecture

```
USER → LOCATION NORMALIZER → QUOTE SESSION → SOURCE REGISTRY
     → PARALLEL LIVE FETCH → SCHEMA VALIDATION → NORMALIZATION
     → RECONCILIATION → QUOTE SEMANTICS → FRESHNESS → RANKING
     → RESULTS → VERIFIED BOOKING HANDOFF → PROVIDER APP
```

Next.js 16 (App Router) · TypeScript strict · Zod · Supabase · Vitest ·
Playwright · MapLibre.

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Source hierarchy

A **source** is where bytes come from; a **provider** is the brand you book. One
source yields many providers, and one provider can arrive from several sources.

Reconciliation precedence, highest first: `UPFRONT_QUOTE` over `ESTIMATE` →
`ACCOUNT_LINKED` over `PUBLIC` → available over unavailable → direct partner
over aggregator over fixture → fresher → has a booking handoff.

Adding a source means implementing `QuoteSource` and registering it. Nothing
else changes.

---

## Quote semantics

Three axes travel with every quote, from the adapter to the DOM:

- **`PriceType`** — `UPFRONT_QUOTE` · `ESTIMATE` · `ESTIMATE_RANGE` ·
  `METERED_ESTIMATE` · `UNKNOWN`
- **`Freshness`** — `LIVE` (≤20 s) · `RECENT` (≤60 s) · `STALE` (≤180 s) ·
  `EXPIRED`, recomputed every second so a card ages on screen
- **`AccountContext`** — `PUBLIC` · `ACCOUNT_LINKED` · `UNKNOWN`

**No false precision.** A `$27–34` range renders as `$27–34`. The midpoint
exists only in `rankingPriceMinor`, is never printed and is never spoken.

**Uncertainty-aware ranking.** An exact $25 upfront fare and a $20–40 estimate
are _not_ ordered by the low end. RideLens compares intervals: heavy overlap
yields "Similar price", a claim resting on a wide range yields "Likely
cheapest", and only a genuinely separated pair yields "Best price".

Normative definitions: [`docs/QUOTE_SEMANTICS.md`](docs/QUOTE_SEMANTICS.md).

---

## Location architecture

**One geocoder, one resolve per endpoint, identical coordinates to every
source.** Geocoding the same address twice with two providers would put Uber's
pickup metres from Lyft's and quietly invalidate the comparison. A full-chain
test asserts every adapter receives byte-identical coordinates.

| Provider             | Key      | Selected when                                       |
| -------------------- | -------- | --------------------------------------------------- |
| Google Maps Platform | required | `LOCATION_PROVIDER_API_KEY` set                     |
| Mapbox               | required | key set and `NEXT_PUBLIC_MAP_KEY` is a `pk.*` token |
| Nominatim + Photon   | **none** | default fallback                                    |

The keyless OSM path is live, permitted and rate-limited to ~1 req/s — fine for
development, **not consumer scale**. `startupChecks` warns `KEYLESS_GEOCODER`
until a commercial key is set.

**Recent routes** for anonymous visitors are stored only in their own browser,
carry no fare, and are cleared with one visible control.

**Privacy:** geolocation is requested only on an explicit press; precise
coordinates never reach logs or analytics; sessions store ~1 km coarse
coordinates; history is user-owned and user-deletable.

---

## Database

Supabase/Postgres, migrations in `supabase/migrations/`. Tables: `profiles`,
`connected_provider_accounts`, `quote_sessions`, `provider_requests`, `quotes`,
`source_discrepancies`, `booking_handoff_events`, `recent_searches`,
`provider_health_events`, `api_usage_daily`, `provider_configuration`.

RLS on every table. Rider tables are owner-only; child rows inherit ownership
through their session. Operational tables have **RLS enabled and no policies**,
so only the service role reaches them, with direct privileges additionally
revoked.

`quote_sessions` stores coordinates as `numeric(6,2)` — the column type makes
precise storage impossible, so the schema enforces the privacy rule rather than
trusting the application layer.

Persistence never blocks a response: a database outage degrades RideLens to
"comparison works, history does not".

---

## Regulated taxi fares

The one price RideLens can show without anyone's permission, because a licensed
taxi's fare is set by a public authority and published rather than quoted.

```
published rate card + measured route + the market's local clock  ─▶  fare
```

- **Airport flat fares** are `UPFRONT_QUOTE`, `HIGH` confidence. $70 JFK ↔
  Manhattan is the rule, not an estimate; it does not move with distance or
  traffic.
- **Metered fares** are a `METERED_ESTIMATE` band, because the meter charges for
  time below a speed threshold and traffic is not observable.
- **Surcharges are evaluated live** in the market's own timezone — the same trip
  costs more at 5pm than at 2pm, and the quote itemises why.
- **Tolls and gratuity are excluded**, and every quote says so.
- **Outside a covered market it returns nothing** and names the markets it
  covers. One city's tariff is never extrapolated onto another.

Cards live in `src/sources/ratecard/tariffs.ts`, each with its authority, source
URL and verification date. They change by rulemaking — Chicago's was rewritten
on 1 July 2026 — so re-verification is on the release checklist.

## The first screen shows a fare

Until a rider typed two addresses, this screen was prose about methodology — an
answer to "why should I trust this?" delivered before anybody had asked, and
before a single number had appeared. It now opens with four real trips, one tap
each:

| Trip                        | What it shows                           |
| --------------------------- | --------------------------------------- |
| Times Square → JFK          | a flat airport fare, fixed by rule      |
| Dupont Circle → the Capitol | a metered cab beside a live shared bike |
| Scarsdale → Chelsea         | no cab may pick up — but a train can    |
| The Loop → O'Hare           | the same trip by train and by cab       |

These are **not** demonstration data. Each is a pair of real coordinates that
takes the ordinary path — live geocoder, live routing, the city's own tariff —
and comes back with whatever it comes back with. If a rate card changes
tonight, they change with it. The fields stay filled afterwards, so the trip can
be edited into your own rather than cleared and retyped.

## A trip has two ends

A railroad publishes a run between two platforms, and for five cycles this
product printed that run as "the trip". It is not. The Loop to O'Hare is a
twenty-two minute walk, a thirty-seven minute train, and then two miles of
nothing — because Metra's Milwaukee West line stops at **Bensenville**, and the
airport is not Bensenville.

So a journey is modelled as legs, drawn to scale, and stated in full:

> 22 min walk to Chicago Union Station, 37 min on board to Bensenville — which
> leaves you 2.1 mi short of O'Hare Airport.

A door-to-door total is claimed **only** when every leg is known and walkable.
Where it is not, the sentence names the distance the fare does not cover and no
total is offered, because a number announcing itself as "all in" while dropping
the larger of two walks is worse than no number at all. The stretch the fare
does not cover is drawn open rather than filled: its width is deliberately
fixed, since sizing it by the walk we estimated would assert that the rider
walks it, and the point is that RideLens does not know how it gets covered.

### The walk is measured, and says when it isn't

Walking has its own router, and that is not an accident. The public OSRM demo
instance this project uses for the map serves exactly one profile — the car —
and answers `/route/v1/walking/` with the driving graph anyway: 2132 m in 248 s
for the Loop→Union Station leg, which is 31 km/h. Walking therefore goes to a
Valhalla instance with a real pedestrian graph, which returns 1815 m in 1349 s
— 1.35 m/s, and 1.28× the straight line.

It matters more than it sounds. Straight-line access understated that walk by
30%, and the Scarsdale one by 89%.

When the router does not answer, the fallback is a straight line at a planning
pace — and the copy changes, because a straight line is the _shortest path that
could possibly exist_, so a time derived from one is a floor rather than an
estimate. A measured leg reads "22 min walk"; a guessed one reads "**at least**
17 min walk", and the total inherits it. A failed integration says so.

`WALKING_BASE_URL` points this at your own router. Both walks are cached for
six hours with in-flight deduplication: a pavement changes on the timescale of
a construction project, not a surge cycle.

## The bottom line

A ride comparison that ranks only rides can be entirely correct and still bury
the answer. The Loop to O'Hare returns a $58.43 metered cab and a $5.50 Metra
fare; ranking them together would let a bike or a train win "cheapest ride"
on almost every trip and quietly turn a ride comparison into a mode comparison.
So other modes stay out of the ranking — and a bar above the results says what
the ranking cannot:

> **$5.50** by regional rail, but it **stops 2.1 mi short of O'Hare Airport**.
> A licensed taxi is $59.43 and goes to the door.

It appears only when the gap clears a fifth of the car fare, and never when the
hero is already the cheapest thing on the page.

Note what it does _not_ say. It shipped once as "**$52.93 less** by regional
rail", which compared a fare that reaches the terminal with one that stops two
miles away — the same category error as subtracting two currencies, which the
module already refused to do a few lines further down. The money still leads,
because $5.50 against $59 is worth knowing. The word "less" is reserved for two
journeys that actually go to the same place.

Where the cheaper option _does_ arrive, the saving is stated and the road time
is set against a door-to-door total that counts every leg — never against the
train run alone, which would make a slower trip look faster. A shared bike is
exempt from the walk arithmetic: its quote already counts both walks, so adding
them again would charge the rider twice.

## When to go

Every fare here comes from a published rule on a clock, so the next 24 hours are
knowable — computed, not predicted. New York adds $2.50 to a metered fare
between 4pm and 8pm and $5.00 to the JFK flat fare; a Metro-North seat is $3.50
cheaper off-peak, a quarter of the ticket.

The results page draws every priceable option on one axis that starts at **now**
and runs a day forward, each row scaled to its own price range and labelled with
its own floor and ceiling. Drag, arrow or tab across it to price a later
departure. Above it sits the single most useful thing about timing this trip —
ranked by what a rider can act on, and by how much the clock moves each fare in
proportion to it, so a dollar off a $127 taxi never outranks $3.50 off a $10.25
train.

There is no equivalent for a market-priced provider, and there will not be. A
forecast wearing the clothes of a fact is the thing this product exists to
avoid.

## Planning ahead

The airport run is the highest-stakes ride most people take and the one they
plan furthest ahead — and it is exactly where a flat fare plus a rush-hour
surcharge produces surprises. Set a departure and the whole comparison
re-prices for that moment: the same rate card, the same arithmetic, the
surcharge that will be in force then rather than the one in force now. A
weekday 6:20am run to JFK is $74.75; the same trip at 5pm is $79.75.

This is the one thing RideLens will say about the future, and only because a
tariff is a rule rather than a market. A projection is labelled **Scheduled
fare**, never "live"; it carries no two-minute expiry, because the rule will
say the same thing in an hour; and auto-refresh switches itself off, because
every poll would return the identical number.

**Sources that cannot honestly project decline.** A bike quote is only honest
because it names a station with a bike in it right now, and nobody knows which
docks will have bikes on Tuesday — so bike share returns nothing and says why.

The horizon is 30 days. Beyond that the rate card behind the answer is likely
to have been superseded by rulemaking, and the projection is only ever as good
as the card it came from.

## Commuter rail, where no city meter reaches

A regulated taxi fare follows the city the trip _starts_ in, so a pickup in the
suburbs has no meter behind it and RideLens used to return an entirely empty
comparison for one of the most ordinary journeys there is. The railroad has no
such gap: its fare is published, fixed by the authority, and usually both the
cheapest option and one of the fastest.

Two operators, and two genuinely different shapes of table:

| Railroad    | Table                                    | Peak?             | Coverage                         |
| ----------- | ---------------------------------------- | ----------------- | -------------------------------- |
| Metro-North | Fares to and from Grand Central, by zone | Yes, peak windows | 112 stations, NY and CT          |
| Metra       | Fare for the pair of zones a trip spans  | No, one fare      | 240 stations, northeast Illinois |

Modelling one as the other would invent fares nobody published, so the engine
carries both shapes. Fares are transcribed from the operator's live fare page
with a `verifiedOn` date; station coordinates, zones, line membership and
scheduled run times come from the operator's GTFS feed.

**The fares are deliberately not read from the feed.** Metra's GTFS still
carries its January 2024 `fare_attributes.txt` against a stops file rebuilt in
July 2026. Ingesting feed fares looks like the rigorous option and is the one
that silently ships last year's prices.

A rail quote states the station you board at, the station you get off at, and
how far each end of the trip is from its platform. It is the price of the train,
not of the door-to-door trip, and it says so. It refuses a station the timetable
serves only a handful of times a day — Metra's O'Hare Transfer is a peak-only
stop, and a real fare for a train that is not running is not an option.

## Shared bikes, live

GBFS is an open standard built so trip planners can read a bike system's live
state; cities often require operators to publish it. Reading it is the intended
use, and it is the most genuinely real-time data here — station counts move
minute to minute.

A bike quote refuses to exist unless a real station within a short walk has a
bike **and** another has a free dock. It shows the walk to that station, the
station's name, and how many bikes are in it. Bikes are kept out of the vehicle
ranking and shown under _Other ways to get there_, because a mode that is almost
always cheapest would otherwise quietly win "cheapest ride".

Covered: Citi Bike, Divvy, Bay Wheels, Capital Bikeshare, Bluebikes.

Bikes and trains share the _Other ways to get there_ section for the same
reason: neither comes to the door, and both would otherwise win a ride
comparison on price alone.

## Deploying

`DEPLOY.md` has the full path. The short version: push to GitHub, import at
vercel.com/new, press Deploy. **No environment variables are required** — a
production build with an empty environment was verified to return a real
JFK ↔ Manhattan flat fare and live Citi Bike prices.

`/api/health` will report `degraded` on a bare deployment, with two errors about
in-memory persistence and rate limiting. That is honest rather than broken:
share links become unreliable across serverless instances and rate limits become
per-instance. Prices are unaffected. Add Supabase and Upstash to clear both.

## Resilience

Three layers sit in front of every upstream call, cheapest first:

1. **Cache** — a recent identical answer, short TTL, account-scoped.
2. **In-flight coalescing** — two riders searching the same route in the same
   second cost one upstream call.
3. **Circuit breaker** — a source that fails four times in a row is skipped
   instantly for 30 s, then probed once. A provider outage otherwise costs a
   full timeout on every search, and real money once a contract exists.

Above them, a session-level deadline guarantees a stream always settles, and
route- and root-level error boundaries guarantee a render fault never blanks
the page — while saying explicitly that the failure was RideLens's, not a
provider's price.

## Cache, rate limiting, cost

**Cache** — key includes source, account scope, locale and route (quantised to
~11 m). `ACCOUNT_LINKED` results are never shared-cached. Per-source TTL,
default 20 s. Refresh bypasses it.

**Rate limiting** — fixed window on a _hashed_ client key, never a raw IP and
never a client timer. Upstash → Supabase → in-memory (refused in production).
Separate buckets for compare, geocode, handoff and admin.

**Cost** — per-source calls, cache hits, errors, timeouts, p50/p95 and success
rate at `/admin`. Estimated cost is modelled and labelled as an estimate.

---

## Account linking

OAuth only — RideLens never asks for a provider password. PKCE, single-use
`state`, AES-256-GCM encryption at rest, no client write access to the token
table, revocation on disconnect.

**Currently disabled**: no provider in scope offers a usable OAuth path for
quote personalisation. Schema, RLS and the encryption boundary exist; the flows
activate with a credential and `TOKEN_ENCRYPTION_KEY`.

---

## Booking links

| Kind                 | Meaning                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `PREFILLED_DEEPLINK` | Built from documented syntax, route filled in                    |
| `PARTIAL_DEEPLINK`   | Source-supplied link that passed the allowlist                   |
| `GENERIC`            | No documented deep link — interstitial, then the provider's site |

- **Uber:** `https://m.uber.com/looking` with `client_id`, `pickup`, `drop[0]`
  (URL-encoded JSON). Requires `UBER_DEEPLINK_CLIENT_ID`.
- **Lyft:** `https://lyft.com/ride` with `partner`, `id` and bracketed
  coordinates. Requires `LYFT_CLIENT_ID`.
- **Curb / Empower:** no documented format — generic handoff.

Every handoff ships `prefillVerification: 'UNVERIFIED'` until a human confirms
the prefill lands in that provider's app. **RideLens does not claim a prefill it
has not tested.**

Every URL is allowlist-validated by exact host match — suffix matching would
pass `m.uber.com.evil.tld` — and the client posts booking intent to
`/api/handoff` for server-side re-validation rather than navigating to a payload
URL.

---

## Security

Highlights; full document: [`docs/SECURITY.md`](docs/SECURITY.md).

- **Authorized access only.** No CAPTCHA bypass, bot-detection evasion, private
  endpoint reverse-engineering, borrowed tokens, pinning bypass, proxy rotation
  or rate-limit evasion. Scraped-data resellers are out of scope by policy.
- Booking allowlist, no open redirects.
- SSRF containment: HTTPS-only, per-call host allowlist, manual redirect
  re-validation, bounded responses. No payload URL is ever fetched server-side.
- Zod validation on every external response; no `dangerouslySetInnerHTML`.
- Structural log redaction for credentials, coordinates and addresses.
- Cross-user cache isolation.
- Strict CSP with no third-party script origins; HSTS; `frame-ancestors 'none'`.

---

## Testing

```bash
npm test              # 615 unit + integration, 40 files
npm run test:e2e      # both suites below, in order
npm run test:e2e:fixtures  # 53 specs × desktop and mobile, deterministic sources
npm run test:e2e:live      # 38 specs, no credentials, real external requests
npm run verify:all         # format, lint, types, tests, build
npm run verify:live        # REAL external requests; never books a ride
```

Mocks are permitted in unit tests, integration tests, E2E and an explicit local
demo mode. Production can never use them.

Plan and coverage: [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md).

### Mock safety

`demoSourceActive = RIDELENS_DEMO_SOURCE === 'enabled' && NODE_ENV !== 'production'`.
A production build ignores the flag and reports `DEMO_SOURCE_IN_PRODUCTION` as
an error; `GEOCODER_PROVIDER=fixture` throws at config load in production.
`DemoQuoteSource.enablement()` re-checks the same condition as a second gate.

This is also why E2E runs against a dev server: the production build genuinely
refuses fixture data.

---

## Deployment

```bash
vercel link
vercel env add OBI_API_KEY production   # repeat per variable
vercel --prod
curl https://<domain>/api/health        # expect no `error` checks
```

Production requires Supabase and a durable rate limiter, or `startupChecks`
reports errors.

**Not deployed:** no deployment platform is authenticated in this environment.
See [`SETUP_REQUIRED.md`](SETUP_REQUIRED.md) §10.

---

## Credentials

See [`.env.example`](.env.example) for the full list and
[`SETUP_REQUIRED.md`](SETUP_REQUIRED.md) for how to obtain each.

RideLens runs with **none** of them set.

---

## Limitations

- **No live quote source is connected.** Every provider requires a commercial
  agreement, or prohibits competitive comparison outright.
- The Obi and Curb Flow request/response schemas are **unconfirmed** — each is
  isolated to one file, and `verify:live -- --dump obi` captures the real shape.
- Deep-link prefill is **untested** in the provider apps; every handoff says so.
- OAuth flows are designed and schema-backed but **not exercised**.
- No hard API spend ceiling — cost is visible, not capped.
- No published accuracy metric: there is no cross-check dataset to evidence one.
- Single-node cache and circuit breaker; a miss costs one upstream call, and a
  recovering source may be probed once per worker.
- Share links are in-memory without Supabase, so they die with the process.
  The UI says so when it mints one.
- Seat capacity is a RideLens model, not provider data — labelled as such
  everywhere it appears.

Detailed analysis: [`docs/FAILURE_MODES.md`](docs/FAILURE_MODES.md).

---

## Troubleshooting

**"No live source connected"** — expected with no credentials. `/api/health`
names the blocker per source.

**`503 NO_SOURCE_CONFIGURED`** — no quote source is enabled. This is deliberate;
RideLens will not fabricate prices.

**Autocomplete is slow** — the keyless geocoder self-throttles to ~1 req/s. Set
`LOCATION_PROVIDER_API_KEY`.

**Uber shows `POLICY_PROHIBITED` even with a token** — by design. Read
`docs/DATA_SOURCE_MATRIX.md` §Uber before setting
`UBER_COMPARISON_RIGHTS_GRANTED=true`.

**A provider's product shows as "Other"** — its name is not in
`src/domain/taxonomy.ts`. Conservative by design: a wrong `STANDARD` mapping
would put a luxury car in the cheapest comparison.

**Blank page in development** — Next's dev server refuses assets to unrecognised
origins. `allowedDevOrigins` in `next.config.ts` covers `localhost` and
`127.0.0.1`; add yours if you browse from another host.

**Map is blank** — the CSP allows only OSM and Carto tile hosts. A CSP wildcard
does not match an apex domain, so both `tile.openstreetmap.org` and
`*.tile.openstreetmap.org` are listed.

---

## Documentation

|                                                            |                                            |
| ---------------------------------------------------------- | ------------------------------------------ |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)             | System design and data flow                |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)             | Product behaviour and UX rules             |
| [`docs/DATA_SOURCE_MATRIX.md`](docs/DATA_SOURCE_MATRIX.md) | Provider access, terms, verification dates |
| [`docs/QUOTE_SEMANTICS.md`](docs/QUOTE_SEMANTICS.md)       | Normative price/freshness definitions      |
| [`docs/SECURITY.md`](docs/SECURITY.md)                     | Threat model and controls                  |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)                   | Coverage and live verification             |
| [`docs/FAILURE_MODES.md`](docs/FAILURE_MODES.md)           | What breaks, and what happens              |
| [`SETUP_REQUIRED.md`](SETUP_REQUIRED.md)                   | Exact partner requests and credentials     |
