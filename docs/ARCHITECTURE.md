# RideLens architecture

> Replaces a document that described RailDrop, an Amtrak fare-watching product.
> See [`AUDIT.md` § 0.3](./AUDIT.md).

---

## System overview

```
  browser
    │  POST /api/quotes  { pickup, destination, stream? }
    ▼
  app/api/quotes/route.ts ──── rateLimit() ──── validation (zod)
    │
    ▼
  quotes/orchestrator.ts
    │   cacheGet(key)  ── hit ──▶ return session
    │   miss
    │   ├── discoverEnabledSources(env)        registry.ts
    │   └── Promise.allSettled(fetchSource ×N) per-source timeout + logging
    │            │
    │            ├── PublicRateCardQuoteSource   ← the only one enabled today
    │            ├── ObiQuoteSource              gated: OBI_API_KEY/SECRET
    │            ├── LyftAuthorizedQuoteSource   gated: LYFT_COMPARISON_AUTHORIZED
    │            ├── CurbFlowQuoteSource         gated: CURB_API_*
    │            ├── EmpowerAuthorizedQuoteSource gated: EMPOWER_API_*
    │            ├── UberAuthorizedQuoteSource   gated: written authorization
    │            └── FixtureQuoteSource          non-production only
    │
    ├── reconciler.ts   dedupe the same product arriving from two sources
    ├── ranking.ts      filter → comparePrices → rank
    └── cacheSet(key)
```

Sources are discovered, not hard-coded. Adding one means implementing
`QuoteSource` and registering it; nothing else changes.

## What the browser keeps

Nothing above survives a reload. Three things do, all of them in
`localStorage`, none of them ever sent anywhere:

```
  ridelens.theme     the scheme choice            theme-toggle.tsx
  ridelens.trips     the trip log                 lib/history/trip-log.ts
  ridelens.watches   price watches                lib/history/price-watch.ts
```

Both of the last two go through `components/local-store.ts`, which reads
disk exactly twice — lazily on first use, and when another tab writes — and
serves everything else from memory. An earlier version read inside
`getSnapshot`, which React calls on every render; the results panel
re-renders once a second off the freshness clock, and scrolling fell from
~120 fps to ~60. The lesson lives in that one file so each store does not
learn it again.

The split is deliberate everywhere: the rules and shapes live under
`lib/history/`, which knows nothing about browsers and is tested without
one, and the `use*` hooks are only the wiring.

### Why the log exists at all

The model cannot answer "is $46 a lot, for this?" — asked what a fare should
be it returns the number already on screen, which is the model grading its
own homework. But the reader has seen this route before, and what they saw
is a real observation. `historyForRoute` refuses to summarise below three of
them, never pools two `MODEL_VERSION`s, and every sentence built from it
carries its own n. See `docs/SECURITY.md` for what is stored and how it is
deleted.

## The keyless live path

`PublicRateCardQuoteSource` is what runs in production today.

```
  OSRM /route/v1/driving      → distance, duration          (measured)
  rates.ts                    → published NYC rate cards     (published)
  fare-engine.ts              → base + per-mile + per-minute (arithmetic)
     + NY fee stack by name   → NYS $2.75, MTA congestion, Black Car Fund
     + tolls.ts               → tolled crossings on the line
  weather-signal.ts           → Open-Meteo precipitation     (measured)
  marketplace-dynamics.ts     → demand curve, zone heat,      (MODEL)
                                provider personality,
                                deterministic per-tick noise
  wait-eta.ts                 → modeled pickup wait           (MODEL)
```

**The boundary between measurement and model is the most important line in this
codebase.** Everything above `marketplace-dynamics.ts` is a fact about the world
or a published rule. Everything from it down is a simulation, however
sophisticated and however convincingly it moves.

`marketplace-dynamics.ts` is deterministic: FNV-1a over the route seeds an
xorshift generator, ticked on a fixed interval, so refreshing changes the quote
the way a marketplace would while remaining reproducible for a given route and
clock. That determinism is a testing property, not a licence to present the
output as observed pricing.

### The tick is the unit of change

Three things assume a price holds for one ~55s tick: the sentence above, the
12-second quote TTL (chosen so a price never outlives a tick), and the
countdown on screen — "Prices reshape in 17s" reads as a promise that they
are not reshaping right now.

For a long time none of that was true. `microVolatility` seeded its jump from
the tick but its drift from `ms / TICK_MS`, the raw clock, so the sine
completed a whole cycle _inside_ every tick: two quotes ten seconds apart came
back up to 3% apart. The drift now advances once per tick over about twelve
minutes, and within a tick the noise does not move at all.

It was found by `tests/unit/fare-invariants.test.ts`, not by reading the code.
An existing test called "is deterministic within the same tick" had passed the
same instant to both calls, so it could only ever prove the function was pure;
it is now named for what it checks.

The smooth demand curve underneath the noise is still a continuous function of
the clock, because it is a model of demand rather than a resample. It is
allowed to move inside a tick; it is not allowed to move enough to notice, and
a test holds it under half a percent.

### Invariants instead of calibration

The corpus is empty and will stay empty until riders report what they actually
paid, so nothing can yet say whether a number is _right_. Plenty can say
whether it is _coherent_, and a model that contradicts itself is wrong without
needing ground truth to prove it. Two fuzzers assert the properties the rest of
the product relies on:

- `fare-invariants.test.ts` — bands contain their centres, a longer or slower
  trip never costs less, rain never lowers a fare, multipliers stay inside the
  ranges their own comments claim, the tick holds.
- `ranking-invariants.test.ts` — `comparePrices` is antisymmetric, never names
  a winner on overlapping bands, and — since it is handed straight to
  `Array.sort` — produces an order in which no later row is outright cheaper
  than an earlier one. Without that, "Best price" would be whichever row the
  engine's sort happened to leave first.

Both draw from seeded generators, so a failure reproduces exactly.

Nothing may make that model _less_ honest about being a model without an
explicit decision to do so.

## Quote semantics

Normalisation, price types, confidence classes and the ranking contract under
uncertainty are specified in [`QUOTE_SEMANTICS.md`](./QUOTE_SEMANTICS.md) and
implemented in `domain/ranking.ts`. The rule that matters architecturally: a
midpoint is a sort key and never a displayed price.

## Caching and rate limiting

Both sit on `MemoryTtlStore` (`lib/quotes/store.ts`): a bounded map with a sweep
on write and LRU eviction at a hard cap. No background timer — an interval keeps
a serverless instance alive and does nothing while the process is frozen between
invocations, so sweeping happens on write, which is when the map grows anyway.

### The tradeoff, stated plainly

**This is per-instance memory, and that is a real limitation, not an
implementation detail.**

- **Rate limiting.** Each instance holds its own buckets. A configured limit of
  30 requests/minute is 30 _per instance_; across a fleet of ten the effective
  limit is 300. It raises the cost of casual abuse and does not stop a
  determined caller. **It is a courtesy, not a control.**
- **Caching.** The same split means a cold instance misses on a key a warm one
  holds. That costs latency and an upstream call, not correctness.
- **Account-linked quotes** are additionally protected by key construction
  (account context and user id are both in the key) and by refusals in _both_
  `cacheSet` and `cacheGet`. A personalised fare cannot be read from a public
  key even if one were somehow written.

`MemoryTtlStore` implements the `TtlStore` interface precisely so a Supabase- or
KV-backed implementation is a drop-in. Until that exists, anything that depends
on a _global_ limit — billing, quota enforcement, abuse response — must not
assume this one holds.

## Booking handoff

`booking/booking-link-resolver.ts` maps a provider and a route to a deep link.
Destinations are allowlisted per provider; a URL arriving in a source payload is
never followed. `/book` is an interstitial that states what is known and what is
not before sending the rider on.

## Configuration and source gating

`lib/config.ts` parses the environment through a zod schema once and caches it.
Every source has a `*Configured()` predicate, and `sourceStatusSummary()` renders
the whole picture on `/admin`. A source that lacks credentials reports
`partner_approval` — distinct from `disabled` and from a source that answered
with no cars, because those are three different sentences to show a rider.

`assertNoSilentMocks()` refuses to let fixtures run in production.
`assertPublicOrigin()` refuses a production build whose absolute URLs resolve to
loopback.

## Deployment

Next.js 16 App Router on Vercel. `appOrigin()` resolves the public origin from
`NEXT_PUBLIC_APP_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` →
localhost; `robots.ts` and `sitemap.ts` resolve it per request rather than
baking a build-time value into a static file.

Security headers ship from `next.config.ts`. The CSP is currently
**report-only** and deliberately so: the app talks to a tile host, a routing
host and a geocoder, and a wrong policy breaks the map rather than the page.
It carries `https://unpkg.com` in `script-src` and `style-src` only because
MapLibre is loaded from that CDN at runtime; bundling the library (see
[`AUDIT.md` § 0.5](./AUDIT.md)) removes both entries.
