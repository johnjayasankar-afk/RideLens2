# Failure Modes

Each entry is a question asked of the architecture, the honest answer, and where
that answer is enforced. Anything marked **Open** is not yet mitigated.

---

### Obi goes down

Its `SourceOutcome` becomes `TIMEOUT` or `ERROR` with `quoteCount: 0`. The
session settles `PARTIAL`, every other source renders normally, and the "Not
included in this comparison" panel names the affected providers. **No stale or
substitute price appears for Uber, Lyft or Empower.**

If Obi is the _only_ enabled source, the session is `FAILED` and the UI says so
explicitly: _"No provider returned a price for this route. Nothing is being
estimated on their behalf."_

_Enforced:_ `engine.ts` `Promise.allSettled` + `runOneSource` catch;
`tests/integration/engine.test.ts` (timeout and total-failure cases);
`tests/e2e/resilience.spec.ts` asserts no price renders.

---

### Curb direct disagrees with Obi

Both candidates are retained. `reconcileQuotes` picks a canonical row by a
deterministic ladder (upfront > account-linked > available > direct-over-
aggregator > fresher > has-handoff) and records a `SourceDiscrepancy` with the
basis-point spread. Above 1000 bps the card shows _"Price may have changed —
confirm in the provider app"_.

**The two prices are never averaged** — an average is a number no provider will
honour.

_Enforced:_ `reconcile.ts`; `tests/unit/reconcile.test.ts` including an explicit
"never averages" case.

---

### Uber returns a range

Rendered as a range: `$27–34`, labelled `Est. range`. The midpoint lives in
`rankingPriceMinor` for sorting only and is never printed or spoken. Against an
exact fare inside that band, the comparator returns `SIMILAR` and the UI says
"Similar price" rather than ranking one above the other.

_Enforced:_ `uncertainty.ts`; `format.ts` `priceDisplay`;
`tests/unit/uncertainty.test.ts`; an E2E test asserts a range card contains an
en dash.

---

### Lyft renames a product

The mapping falls through to `OTHER`, which is excluded from the Standard and
Best views. A renamed premium product cannot silently appear as a cheap standard
car. All mappings live in one file, so the fix is one edit.

**This is a live risk, not a hypothetical.** The first version of `taxonomy.ts`
used `/\bxl\b/`, which does not match `UberXL` — there is no word boundary after
`Uber`. Every XL product silently became `OTHER`. A unit test caught it. The
patterns now avoid a leading `\b` on tokens providers glue to a brand prefix.

_Enforced:_ `taxonomy.ts`; `tests/unit/taxonomy.test.ts` including the fallback
case.

---

### Empower's price is only an estimate

`EmpowerAuthorizedQuoteSource` hard-codes `ESTIMATE`. `UPFRONT_QUOTE` requires an
explicit `fare_is_guaranteed: true` in the payload. The card shows `Est.`, and
confidence is `MEDIUM`, so a firm quote wins ties against it.

_Enforced:_ the adapter; two tests pinning both directions.

---

### A quote expires while it is on screen

`useCompareSession` ticks `now` once a second and every card re-derives its
freshness. On expiry the badge changes, the Book button disables, and the card
reads _"This quote expired. Refresh for a current price."_ A provider-declared
expiry is authoritative and overrides the age heuristic.

_Enforced:_ `freshness.ts`; `CompareApp` re-derivation;
`tests/unit/freshness.test.ts`; the adapter test asserts a past provider expiry
yields `EXPIRED` on arrival.

---

### The user refreshes repeatedly

Three defences: an in-flight guard in `useCompareSession` (a double-click cannot
issue two requests); the short-TTL cache absorbing repeats; and server-side rate
limiting on a hashed client key with `429` + `Retry-After`. Client timers are
never trusted.

_Enforced:_ `useCompareSession.ts`; `cache.ts`; `ratelimit.ts`; a full-chain test
asserts the third request is refused.

---

### The user's current location moves

The route is canonicalised once per comparison and pinned for that session. A
moving rider does not silently re-price mid-comparison. Refresh re-uses the same
canonical route; getting a new position is an explicit "Use current location"
press.

---

### Two addresses geocode to slightly different coordinates

Cannot happen across providers: one geocoder resolves once and every adapter
receives the identical `CanonicalLocation`. A full-chain test asserts the exact
coordinates in Obi's and Curb's request bodies are identical and equal to the
session's.

Across _cache reads_, coordinates are quantised to 4 dp (~11 m), close enough
that the fare is unchanged.

---

### A provider returns an unexpected currency

Non-ISO codes are dropped at the adapter with a warning. Valid but unsupported
codes render through `Intl.NumberFormat`, falling back to `"25.00 XYZ"` if the
runtime rejects the code. **Cross-currency quotes are never numerically
compared** — ranking orders them by currency code and no savings line is
generated.

_Enforced:_ `money.ts`; `ranking.ts` currency guard; tests for both.

---

### A source response is malformed

Zod rejects it, the adapter raises `SourceError(kind: 'SCHEMA')`, the source
fails, and the session goes `PARTIAL`. Nothing is invented, and a partial parse
is never salvaged into a price.

_Enforced:_ every adapter; `tests/integration/adapters.test.ts`.

---

### One user's account-linked pricing enters the shared cache

Structurally impossible: the cache key contains the account scope, and
`ACCOUNT_LINKED` results are not written to the shared cache at all.

_Enforced:_ `cache.ts`; `engine.ts`; tests in both `security.test.ts` and
`engine.test.ts` asserting user A, user B and anonymous all miss each other.

---

### A booking URL from a payload is malicious

Validated against the provider's allowlist by **exact** host match — suffix
matching would pass `m.uber.com.evil.tld`. A failing URL is discarded and
replaced with one RideLens constructed. The client posts intent to
`/api/handoff` for server-side re-validation rather than navigating to a payload
URL.

_Enforced:_ `booking/allowlist.ts`; `booking/resolver.ts`; `/api/handoff`;
tests for lookalikes, cross-provider swaps, embedded credentials and
`javascript:`.

---

### API pricing becomes expensive

Per-source counters (calls, cache hits, errors, timeouts, p50/p95) feed `/admin`.
Per-source TTLs, duplicate-search deduplication and per-bucket rate limits all
reduce call volume. Estimated cost is modelled from a configurable per-call rate
and labelled an estimate — never presented as a bill.

**Open:** there is no hard spend ceiling that disables a source at a budget
threshold. The counters make the problem visible; they do not stop it.

---

### Provider partner terms change

`docs/DATA_SOURCE_MATRIX.md` carries a _Verified_ date per row and a
re-verification checklist. Terms are enforced in code by `enablement()`, so
revoking access is a single env change — `UBER_COMPARISON_RIGHTS_GRANTED=false`
disables the Uber adapter without a deploy.

**Open:** nothing detects a terms change automatically. Re-verification is a
human step on the release checklist.

---

### A source takes 15 seconds

`QUOTE_REQUEST_TIMEOUT_MS` (default 8 s) is enforced per source by both the
orchestrator and the HTTP client's `AbortController`. Fast sources have already
streamed and rendered; the slow one resolves to `TIMEOUT` and appears in the
source-status panel. It cannot delay results that already arrived.

---

### Production is running on mock configuration

`demoSourceActive` is `RIDELENS_DEMO_SOURCE === 'enabled' && !isProduction`, so a
production build ignores the flag entirely and reports
`DEMO_SOURCE_IN_PRODUCTION` as an error. `GEOCODER_PROVIDER=fixture` throws at
config load. `DemoQuoteSource.enablement()` re-checks the same condition as a
second gate. `/api/health` reports `fixtureSourceActive` explicitly.

_Enforced:_ `config/env.ts`; `tests/unit/config.test.ts`; an engine test asserts
a production config with the flag set produces zero quotes and zero sources.

---

### The geocoder is unavailable

Autocomplete degrades silently — the rider can still type a full address.
`canonicalizeRoute` failing returns `502 GEOCODER_UNAVAILABLE` with a plain
message. No comparison is attempted on unresolved coordinates.

---

### No live source is configured at all

The honest failure. `/api/health` reports `liveDataAvailable: false`, the home
page shows a "No live source connected" banner with the specific blocker, and
`POST /api/quotes` returns `503 NO_SOURCE_CONFIGURED`. **This is the current
state of a default deployment** — see `SETUP_REQUIRED.md`.

---

### The client disconnects mid-stream

`safeEnqueue` swallows the write error; the session still completes and is
persisted. The rider simply stops receiving updates.

---

### A source fails repeatedly

The circuit breaker trips after four consecutive failures and skips that source
entirely for 30 seconds, then admits one probe. Without it every comparison
would pay the full 8-second timeout for a source that cannot answer — and, once
a paid contract exists, would bill for calls that cannot succeed.

The card copy names the reason: _"Skipped: this source failed 4 times in a row.
Retrying in 27s."_

_Enforced:_ `orchestration/circuit.ts`; unit tests for every transition and an
integration test asserting no fifth upstream call is made.

---

### Two riders search the same route at the same instant

`InFlightRegistry` collapses them into one upstream call; the second joins the
first. The cache only helps once a response has landed, so this closes the
window while one is still in flight. Account-scope isolation is preserved
because the coalescing key _is_ the cache key.

_Enforced:_ `orchestration/coalesce.ts`; an integration test asserts one call
for two simultaneous identical sessions.

---

### The routing service is slow or down

The road path is fetched separately, after results are already on screen, so it
can never delay a fare. On failure the map keeps its dashed straight line — a
schematic that reads as one.

---

### A share link is guessed or replayed

Ids are 12 characters of a 32-symbol alphabet, which is not enumerable, and
`shared_routes` has RLS on with no client policies. A share carries no price,
so a replayed link cannot show a stale fare — it re-runs the comparison live.
Rows expire after 30 days.

---

### A render error blanks the page

Route- and root-level error boundaries catch it. The copy states explicitly
that the failure was RideLens's and that nothing shown was a price, so a rider
does not walk away believing a provider was expensive.

---

### The rider goes offline mid-session

`navigator.onLine` is used only to _explain_ a failure that already happened,
never to pre-emptively block a search — it reports link state, not
reachability, and guessing would break usable-but-unusual networks.

---

### Auto-refresh is left running

It pauses when the tab is hidden and stops itself after 12 cycles, telling the
rider it has done so. A forgotten tab cannot poll all day.

---

### A city changes its taxi tariff

The published number goes stale silently — nobody notifies a downstream app.
Chicago rewrote its card effective 1 July 2026, the first change in a decade,
and a stale transcription would have understated every Chicago fare by roughly
a fifth.

Mitigation is procedural, and deliberately visible: every card carries
`authority`, `sourceUrl` and `verifiedOn`, the detail sheet links the rate card
and prints the check date, and re-verification is on the release checklist in
`docs/DATA_SOURCE_MATRIX.md`. There is no automatic detection.

---

### A rider asks for a city with no published card

The source returns **no quote** and names the markets it does cover. It never
extrapolates one city's tariff onto another — a New York meter rate applied to
Denver would be a fabricated price wearing a regulator's authority.

_Enforced:_ `tariffForPickup` returns null outside a covered bounding box; an
integration test asserts zero quotes, a named-markets warning, and that no
upstream routing call was wasted.

---

### The routing service is down and a fare cannot be measured

The rate card raises `UPSTREAM` and contributes no quote. It does not fall back
to straight-line distance: a meter charges for the road actually driven, and a
crow-flies fare would be confidently wrong rather than absent.

---

### A GBFS feed is unreachable or malformed

**Detected by** the fetch failing, or Zod rejecting the payload.

**Behaviour.** The source returns no bike quote and a warning naming the system.
Every other source is unaffected: the feeds are read independently of the ride
sources, and a bike is an extra option, never the basis of the comparison.

**Why not fall back to a cached shape.** A bike quote's whole claim is that a
named station has a bike in it _right now_. Serving that from a stale feed would
send someone to an empty dock, so the option simply disappears.

### Station counts go stale

**Detected by** the feed's own `last_updated`, carried into the quote with the
operator's declared TTL — typically 60 seconds, the shortest in the product.

**Behaviour.** Normal freshness rules apply, so the card ages `LIVE → RECENT →
STALE` and is refused past expiry like any other quote. The bike detail shows
the station's name and its live count, so a rider can see exactly what is being
claimed and how old it is.

### No bike or no free dock

**Detected by** `planBikeTrip`, which refuses the trip.

**Behaviour.** No bike quote is offered, with the reason recorded (no bike
nearby, no dock at the destination, stations too far apart, or the same station
at both ends). The alternative — quoting a bike and letting the rider discover
the empty rack — is worse than not offering one.

### A bike would win "cheapest ride"

**Not a runtime failure — a design one, and worth stating.** A bike is almost
always the cheapest way to travel two miles. If it entered the ranking, the
comparison would stop answering "which ride is cheapest" and start answering
"should you cycle", which is not what anyone opened the app for.

**Behaviour.** Bikes carry category `BIKE`, the ranker excludes them, and the UI
shows them under _Other ways to get there_.

### A meter boundary is hit exactly

**Was a real overcharging bug.** Computing `ceil(miles / unit)` in floating point
put exact boundaries a hair over an integer, charging a whole extra unit on 801
of the 1,600 exact boundaries in the shipped rate cards.

**Behaviour.** `meterUnits()` computes in metres with a two-metre tolerance —
comfortably inside float error, far below the smallest real unit (1/9 mile ≈
179 m). A test asserts every boundary in every card charges N units, and that
25 m past one charges N+1.

### Two places disagree about the same quote

**What happened.** A taxi quote carries `UNKNOWN` availability, because a rate
card knows the fare exactly and nothing about where the cabs are. The card read
that as "not stated" and offered _How to ride_; the detail sheet read it as
"no", disabled its button with _Not bookable right now_, and listed availability
as **"No vehicles right now"** — a sentence the source never said and had no way
of knowing.

**Fix.** `isBookable()` in the domain is now the single reading of that, used by
the ranking, the card and the sheet. The sheet distinguishes three states rather
than two: available, no vehicles, and not stated. A credential-free E2E test
opens a quote and asserts the two surfaces agree.

**The general lesson.** Any rule about a quote that two components each decide
for themselves will eventually be decided differently, and the user sees the
contradiction before we do.

### The map is resized by something other than opening it

**What happened.** MapLibre sizes its drawing buffer once and does not watch its
element, so anything that changes the container has to tell it. A single 220ms
timeout after the expand flag flipped was doing that job, and on a phone it lost
the race: the expanded map painted tiles across the top 250 pixels — exactly the
collapsed height — and left the rest black.

**Fix.** A `ResizeObserver` on the container. It fires when the box actually
changes, however it changed: expanding, collapsing, rotating the device, the
on-screen keyboard opening, a scrollbar appearing. The timeout survives only to
re-frame the route once the panel has settled, which is a different job.

**Test.** The credential-free suite expands the map and asserts the canvas fills
its container to within the 1px border.

### A pickup just outside a covered city

**What it looks like.** A route from Scarsdale to Chelsea draws its map, reports
24 miles and 45 minutes, and returns no price at all.

**Why that is correct.** A regulated fare belongs to the place the trip starts —
the meter is the meter of whoever licensed the cab at the kerb. A New York
yellow cab may not pick up in Westchester, so no New York fare applies, and
Westchester's own fares are set by each town rather than by the county.

**What was wrong about it.** The message said only "not covered", which reads as
a gap in the app rather than a gap in what any published tariff can answer. When
the _destination_ is in a covered market, the warning now says so, and says the
same trip in the other direction is priced.

**The related bug this exposed.** The market boxes were rectangles, so pickups
in Newark, Jersey City and Evanston were being priced on the neighbouring city's
card. See DATA_SOURCE_MATRIX for the polygons that replaced them.

### An open dialog throws focus back to the page behind it

**What happened.** The sheet's key handler lived in an effect that depended on
`onClose`. Callers pass an inline arrow, so that is a new function on every
render of the page — and the page re-renders once a second to age the freshness
label. The effect therefore tore down and re-ran on every tick, and its cleanup
calls `returnFocusRef.current?.focus?.()`, which is correct on close and wrong
otherwise. An open dialog put focus back on the button that opened it, once a
second.

**How it presented.** An intermittently failing focus-trap test — roughly one
run in sixteen. It was not a flake. For anyone navigating by keyboard or screen
reader the dialog was ejecting them mid-sentence, every second, in production.

**Fix.** `onClose` behind a ref, so the effect depends only on `open` and its
cleanup runs when the dialog actually closes. The trap also positions by index
rather than by identity now: the focusable list is recomputed on each Tab and
the sheet's contents mount as data arrives, so "is this element the last one"
was a question that could change answer between keystrokes.

**Test.** `an open dialog keeps focus while the page ticks` holds focus on the
close button and samples every 500ms for four seconds. Reverting the fix fails
it at 1500ms, naming the button focus drifted to.

### A cached empty result loses its explanation

**What happened.** The most useful sentence this product produces is often the
one attached to _no_ result: "No published taxi rate card for this pickup.
Covered today: New York City, Chicago, …". It travels as a source warning, and
the fresh-fetch path turned warnings into the outcome message. The cache-hit
path set `message: null` regardless.

So the sentence was said once and then, for everyone served from cache, not at
all — leaving a route with no prices and no reason. And an empty result is
exactly the reply most likely to be cached, because it is cheap and repeatable.

**Fix.** The cached outcome carries the cached result's own warnings, so a hit
says precisely what a miss says. Tested at both levels: an integration test runs
the same uncovered city twice and compares the messages, and a credential-free
E2E searches Denver twice and asserts the panel explains itself both times.

### A cached quote is nearly dead when it is served

**What happened.** A cache hit four seconds from expiry is worse than a miss.
The rider gets a price that greys out while they are still reading it, and the
only thing gained is one saved upstream call. It showed up as a card offering
"How to ride" beside a detail sheet saying "Not bookable right now" — both
correct, a second apart.

**Fix.** `MIN_REMAINING_LIFE`: an entry with less than a fifth of its life left
is treated as absent and refetched. The taxi rate card caches for two minutes,
so the last twenty-four seconds are given up; GBFS caches for sixty, giving up
twelve.

### Basemap tiles are slow, or the provider starts asking for a key

**What happened once already.** The map briefly used CARTO's light/dark
basemaps, which match a dark interface far better than plain OpenStreetMap. They
now return a tile stamped **"API KEY REQUIRED"** to unauthenticated callers — so
the map rendered, and every tile in it said that. It was reverted the same hour.

**Current behaviour.** Tiles come from OpenStreetMap's own servers, which need no
key. In dark mode the raster layer is toned down with paint properties
(`raster-opacity`, `raster-saturation`, `raster-contrast`) rather than a CSS
filter, because the route and the station dots are drawn into the same canvas
and a CSS filter would recolour them too.

**Known cost.** OSM's tile servers are volunteer-funded, rate-limited and often
several hundred milliseconds away, so the basemap can take a few seconds to
paint on a cold view. The route line, the markers and the station dots do not
wait for it — they are drawn from data already in hand, so the map is useful
before it is pretty.

**What production should do.** Move to a tile provider with a contract and a CDN
(MapTiler, Stadia, Protomaps self-hosted). That is a key and a bill, which is
exactly why it is not the default here. The change is one function,
`basemap()` in `src/ui/RouteMap.tsx`, plus the `img-src`/`connect-src` hosts in
`next.config.ts` — and OSM's tile usage policy is a reason to make it before any
real traffic, not after.

## Known gaps

| Gap                                 | Impact                                   | Notes                                                                                          |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No hard API spend ceiling           | Cost visible but not capped              | Counters exist; enforcement does not                                                           |
| No automated terms-change detection | Manual re-verification                   | Checklist in the matrix doc                                                                    |
| Deep-link prefill unverified        | UI claims nothing it has not tested      | All handoffs ship `prefillVerification: 'UNVERIFIED'`; requires a human with the provider apps |
| Obi and Curb schemas unconfirmed    | Adapters may need a field-name change    | Confined to one file each; `--dump` captures the real payload                                  |
| OAuth flows not exercised           | Account linking disabled                 | Schema, RLS and encryption boundary exist                                                      |
| Single-node cache                   | Slightly lower hit rate across instances | A miss costs one upstream call; correctness is unaffected                                      |
