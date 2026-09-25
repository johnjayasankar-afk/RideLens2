# Test Plan

## Principle

Tests exist to keep RideLens **honest**, not merely working. The highest-value
tests here assert what the product must _never_ do: never print a midpoint,
never call an estimate upfront, never substitute a fixture for a failed source,
never leak one rider's price to another.

Mocks are permitted in unit tests, integration tests, E2E and an explicit local
demo mode. **Production can never use them** — `demoSourceActive` requires
`NODE_ENV !== 'production'`, and a config test pins it.

## Layers

| Layer             | Tool                  | Boundary replaced                                    | Count           |
| ----------------- | --------------------- | ---------------------------------------------------- | --------------- |
| Unit              | Vitest                | none — pure functions                                | 135             |
| Integration       | Vitest                | the network socket only                              | 40              |
| E2E               | Playwright            | external sources (fixture source + fixture geocoder) | 19 × 2 projects |
| Live verification | `npm run verify:live` | **nothing — real external requests**                 | —               |

Run: `npm test` (unit + integration), `npm run test:e2e`, `npm run verify:all`.

## Unit coverage

**Money** — the float trap (`23.84 * 100 === 2383.9999999999995`), string
parsing with symbols, non-2dp currencies (JPY 0, KWD 3), half-up rounding,
negatives, unparseable input throwing rather than becoming zero, low-biased
midpoints, `$27–34` rendering without trailing zeros.

**Uncertainty** — the headline case: exact $25 vs $20–40 must **not** yield
`A_CHEAPER`. Plus non-overlap, small overlap with firm prices, small overlap
with a shaky price (hedges to "likely"), large overlap, sub-dollar gaps, and
antisymmetry.

**Freshness** — the LIVE→RECENT→STALE→EXPIRED ladder, provider expiry overriding
age, clock skew tolerated, unparseable timestamps treated as expired, and
re-derivation as a quote ages on screen.

**Taxonomy** — every provider's products, luxury kept out of STANDARD, Curb kept
in TAXI, Empower's Premium XL resolving to XL, and unknown products falling to
OTHER rather than being guessed.

**Ranking** — price order, the firmer promise winning statistical ties,
unavailable and expired options sinking, determinism under input reordering, no
cross-currency numeric comparison, FASTEST ordering, BEST_VALUE's published
wait-cost trade-off, and filter partitioning.

**Reconciliation** — collapsing duplicates to one row, the full precedence
ladder, freshness tie-breaks, order-independence, material vs minor discrepancy
classification, **never averaging**, fixture ranked below real sources, and no
cross-currency discrepancy.

**Savings** — exact integer savings, premiums stated plainly, "similar price"
instead of a false claim, hedged copy on uncertain ranges, and no unbookable or
cross-currency baseline.

**Security** — booking allowlist (lookalike domains, cross-provider swaps,
non-HTTPS, embedded credentials, `javascript:`), log redaction (credentials,
coordinates, addresses, coordinates in free text), cache isolation (per-user,
per-source, per-locale, per-route), TTL expiry and eviction, and SSRF
containment.

**Config** — fixture data refused in production, the fixture geocoder throwing in
production, geocoder selection, every startup check, and each source's blocker
code (`POLICY_PROHIBITED` for Uber even _with_ a token present).

**Booking** — current Uber and Lyft deep-link syntax, product_id only for a
valid UUID, honest degradation without attribution, and source-supplied URLs
accepted or discarded by the allowlist.

**Rate limiting** — window behaviour, per-key independence, window reset,
hashed client keys that do not contain the IP, and per-bucket budgets scaling
from one configurable base.

**Regulated fares** (32 tests) — the exact JFK ↔ Manhattan flat fare and its
surcharges; a flat fare not moving with distance; the $5 airport rush surcharge
rather than the $2.50 metered one; no overnight surcharge on a flat fare; both
directions; metered unit arithmetic and meter-style round-up; the slow-traffic
band appearing only when a route runs below free-flow; congestion surcharge
zone tests; weekday-only rush; Chicago's 3:30pm start not rounded to 4pm;
Chicago's July 2026 rates; DC's eighth-mile increments reconstructing $2.56 per
mile exactly; SF having no time-of-day surcharge; components summing to the
fare; integer cents; midnight-wrapping windows; and local time read in the
market's timezone rather than the server's.

**Fare accuracy** (`fareaccuracy.test.ts`) — one case per real difference
between what the app used to print and what a passenger is charged. Directional
charges billed in one direction only (Newark, Boston's Logan toll, Chicago's
departure tax, SFO's pick-up fee) and LaGuardia's in both, because that rule
says both. The DC emergency fuel surcharge gone and the $0.50 passenger
surcharge kept. Per-passenger charges in Chicago, DC and Philadelphia, and
inert in New York. The US holiday calendar, fixed and floating, read in the
market's timezone, and New York's rush-hour surcharge suspending on
Thanksgiving. Tolls found on a route through the Queens-Midtown Tunnel and not
found on one over the free Queensboro Bridge, never crossing markets, always at
the top of the band and never in the floor. Philadelphia's monthly fuel
surcharge applying in September and expiring by November with an explanation.
And the structural guard: **every zone a rate card names must fall inside that
card's own bounding box**, which is how a pickup at SFO or Dulles came to match
no market and return no fare at all.

**Visual sweep** (`scripts/visual-sweep.mjs`) — every screen a rider can reach
(empty, filled, results, detail sheet, handoff, expanded map, shortcuts) at
seven widths from 360 to 1440, in both schemes: 98 states. It screenshots each
one and, more usefully, measures it — horizontal overflow, elements wider than
the viewport, text clipped by its own box, and interactive targets under the
minimum size.

Its first run flagged 623 undersized tap targets across every state: "Save
Home" at 62×17, "Current location" at 97×19, the clear button at 22×22, "Details
· where this price came from" at 200×17. All text-styled controls with no
padding, all below even the 24px WCAG 2.2 floor, all on a phone. The `.rl-tap`
utility grows the hit area with padding and pulls the visual box back with an
equal negative margin, so the design stays tight while the target does not.

**Accessibility** (`a11y.spec.ts`) — axe-core at WCAG 2 A and AA against the
three states a rider actually sees: the empty form, a results page and the
detail sheet, in both colour schemes. Plus the things axe cannot check: every
control on the empty form reachable by Tab, the compare button correctly _not_
a tab stop while disabled and joining the order once the route is complete, the
whole route submittable from the keyboard, and the detail sheet holding focus
through twenty-five tabs and closing on Escape.

It found three real defects on its first run. `--text-4` was 2.75:1 against the
page in light and 3.36:1 against a card in dark, carrying the tagline, the field
labels and the status legend. Three more places faded text with `opacity`, which
lands on a colour nobody chose — one came out at 3.14:1. And the map container
was `role="img"` around MapLibre's own attribution button: a screen reader
announced one image, then put the user inside it.

**Colour contrast** (`contrast.test.ts`) — the same arithmetic as axe, run
against `globals.css` in a millisecond rather than a browser. Every text token
against every surface it can sit on, in both schemes, at 4.5:1; inverse text on
the inverse surface; each semantic colour on its own soft background; and a
minimum visible step between the muted levels, because three tokens that all
clear the bar but look identical are one token wearing three names.

**Design tokens** (`tokens.test.ts`) — every `var(--x)` in a component and in
the stylesheet resolves to a token that exists, and every palette colour is
redefined for dark mode. This exists because `FilterBar` styled its pills with
`--text-secondary`, `--text-tertiary` and `--surface-raised`, none of which the
palette defines. CSS does not warn; the declarations were simply invalid and the
properties inherited, so the filter row took its parent's colour and its
"raised" background was transparent. A typo in a token name should fail a test,
not ship as a vibe.

**Trip summary** (`summary.test.ts`) — a range stays a range in copied text and
the midpoint never appears, each price keeps its certainty label, unavailable
sources are named rather than dropped, and the whole thing is marked a snapshot.

**Fare clock** (`fareclock.test.ts`) — a rise reported before rush hour starts;
the net saving when a rush surcharge ends and an overnight one begins; the
projected price asserted equal to pricing that instant directly; silence when the
next change is beyond the horizon; airport flat fares carrying their own rush
surcharge; a spring-forward transition where the label must describe the instant
actually priced; and an exhaustive sweep over all five markets at five-minute
resolution asserting nothing is ever reported outside its stated horizon or in
the wrong direction.

**Meter boundaries** — every exact unit boundary in every shipped rate card
charges exactly N units, and 25 m past one charges N+1. This is the regression
guard for a real overcharging bug: float division in miles pushed exact
boundaries past an integer and `ceil` added a whole unit on roughly half of
them.

**Shared bikes** — station selection preferring one that actually has a bike,
e-bikes counting, closed stations ignored, the walking cap enforced, a free dock
required at the far end; trips refused with a reason when no bike, no dock, too
far, or same station; fares from the published unlock plus per-minute rate,
collapsing to a point when a plan has no per-minute component, and always in
whole cents.

**Suggestion ranking** — an airport outranking its own car park, cargo and
rental lots demoted, bare IATA codes recognised, exact matches preferred, and
stable ordering so results do not shuffle between keystrokes.

**Resilience** — every circuit-breaker transition (closed → open → half-open →
closed / re-open), single-probe enforcement, failures outside the window not
compounding, source independence; and in-flight coalescing including shared
rejections and slot release.

**Capacity** — category and product-name seat modelling, conservative boundary
behaviour (a four-seat car excluded for a party of five), and the guarantee
that capacity always reports itself as a model rather than provider data.

**Fare split** — parts always summing back to the total exactly across many
totals and party sizes, remainder distribution, and rejection of a nonsensical
party size instead of dividing by zero.

**Share** — id shape and alphabet (no `i`/`l`/`o`/`u`), 5,000-sample collision
check, malformed-id rejection, TTL expiry, and trip-summary copy that always
states the provider confirms the fare.

## Integration coverage

**Adapters** (`tests/integration/adapters.test.ts`) — each provider's fixture
through the real HTTP client, real Zod schemas and real normalisers. Asserts
mixed price semantics, Uber miles→metres, Lyft cents **not** re-scaled, Empower
never upfront without an explicit guarantee, Curb's upfront/metered split,
malformed payloads rejected, missing currency dropped, `401`→`UNAUTHORIZED`, and
**zero network calls while a gate is closed**.

**Orchestration** (`engine.test.ts`) — concurrency measured by wall clock
(2 × 200 ms sources settle in < 380 ms), failure isolation, total failure,
progressive settle callbacks, reconciliation of duplicate Uber rows, cache hit
and `forceRefresh`, cross-user cache isolation, and fixture safety in both
directions.

**Share links** (`share.test.ts`) — the privacy property the design exists for:
the returned URL contains no coordinates and no price; resolution returns the
canonical route; an unresolvable route is refused rather than minting a dead
link; unknown ids 404 and are marked non-retryable.

**Resilience** (`resilience.test.ts`) — two simultaneous identical comparisons
make one upstream call; different routes do not coalesce; four consecutive
failures stop a fifth call and the outcome says why; a disabled source never
trips the breaker; a source that never resolves still settles inside the
session deadline.

**Bike share** (`bikeshare.test.ts`) — a priced trip from live stations and the
published plan; the cheaper classic plan preferred over the e-bike one; a
specific station named with its live bike count; the operator's own timestamp
and TTL carried through; refusal when no station has a bike; nothing returned
outside a covered system without calling any feed; a warning rather than a
failure when a feed is unreachable; and `INFO_ONLY` booking, because there is
nowhere to send anyone.

**When to go** (`departure.test.ts`, plus three live E2E) — which of several
true statements is the useful one: a rise inside two hours beats a saving hours
away, and candidates are then ranked by how much the clock moves the fare _in
proportion to it_, so a $1.00 drop on a $127 taxi does not outrank a $3.50 swing
on a $10.25 train. Bands resolve to a price at any minute and clamp at both
ends; a change landing after midnight is flagged as tomorrow; a fare that never
moves produces no advice at all. The live tests guard the invariant that broke
once: the day chart and the headline price are two views of one number, and they
must agree.

**Journeys** (`journey.test.ts`, `walking.test.ts`, plus six live E2E) — that a
door-to-door total is claimed only when every leg is known and walkable, and is
null otherwise; that both ends are reported when neither is walkable, which is
the defect the live suite caught and no unit test had; that a bike's walks are
never counted twice, its total returning exactly the operator's own figure;
that segments sum to one and no leg is drawn too thin to see; and that every
sentence says what it is entitled to say. The router tests cover the three ways
a walk can be untrustworthy — no answer, an unrecognisable answer, and a route
shorter than the straight line between its endpoints, which is geometrically
impossible — plus the politeness guarantees: one request per walk, simultaneous
requests collapsed, failures backed off, and none spent on a distance nobody
walks.

**The cross-mode verdict** (`verdict.test.ts`, plus six live E2E) — when the
cheapest way to make a trip is not the one leading the ride ranking. The saving
must clear a fifth of the car fare; currencies must match; an unavailable
option is excluded on _both_ sides, which is the defect these tests found (an
empty docking station could be announced as cheapest); a bike gets a bike's
vocabulary rather than a train's. The walk arithmetic has its own group: a
walkable access distance must produce an all-in total, the printed parts must
sum to that total, an unwalkable one must state the access and drop the road
comparison, and a walk that rounds to nothing must not print "about 0". The
live E2E assert relationships rather than figures — the saving equals the
difference of the two prices on screen — so a filed rate change does not break
them.

**Regional rail** (`rail.test.ts`, unit and integration) — every station
carrying a zone the table prices and a line the timetable runs; published fares
pinned to the cent for both operators; peak charged on the arrival at the
terminal inbound and the departure outbound, with the reverse-peak window, and
off-peak all weekend and on holidays; a boundary-straddling boarding window
producing the band and never a number inside it; the party multiplying because
each rider buys a ticket; Metra charging one fare at 8am, 1pm and 5:30pm alike
and claiming no onboard premium it does not publish; the best _connected_
station pair chosen rather than the nearest twice, because the terminal nearest
a Loop address is on a different line from the train out of Evanston; and
refusals with their reason for a trip too short, an access leg longer than the
trip, both ends in town, a pair no single line connects, and a station the
timetable serves a handful of times a day.

**Rate card** (`ratecard.test.ts`) — enablement with no credential; an airport
flat fare as `UPFRONT_QUOTE` with a collapsed band; a city trip as a
`METERED_ESTIMATE` band; null ETA and null trip duration, because a rate card
knows neither; provenance carried on the quote; no quote and a named-markets
warning outside coverage, without wasting an upstream call; honest failure when
the route cannot be measured; and a full session succeeding with nothing
configured.

**Full chain** (`full-chain.test.ts`) — typed addresses → geocode → session →
sources → normalise → reconcile → rank → API response, asserting the identical
coordinates reach every adapter, the ranking invariant holds under the
uncertainty comparator, semantics survive, plus the NDJSON stream shape, handoff
validation and `/api/health` honesty.

## E2E coverage

Runs against the real built app with the fixture source and fixture geocoder,
on desktop (1440×900) and mobile (Pixel 7).

Anonymous flow with no signup wall · autocomplete selection and keyboard
navigation · cheapest as hero with a savings line · ranges rendered as ranges ·
upfront labelled upfront · filters partitioning and keeping luxury out of the
default view · sort by fastest reordering · refresh · unavailable products not
bookable · the booking interstitial restating route, price and age · handoff
resolving to an allowlisted host · fixture sessions labelled not-live · every
card answering who/how much/how soon/what type/how fresh · partial failure
showing zero prices · server error surfaced · **location denial leaving search
fully usable** · recent routes remembered locally, carrying no price, and
clearable · 390 px with no horizontal scroll and ≥44 px tap targets.

Feature coverage (`features.spec.ts`): the detail sheet explaining price type,
source and prefill status · exact fare splitting · Escape closing a sheet ·
share links containing no coordinates · opening a share running a _fresh_
comparison · unknown shares 404ing · party-size filtering · auto-refresh
counting down and switching off · saved Home/Work surviving a reload ·
recents carrying no price · price history after a refresh · keyboard shortcuts
firing outside fields and _not_ inside them · no source-status panel when
nothing failed, and a disclosure with zero prices when something did · the map
labelling its road estimate · copying trip details to the clipboard.

**E2E runs against a dev server on purpose.** `next start` forces
`NODE_ENV=production`, where `loadConfig` throws on `GEOCODER_PROVIDER=fixture`
and `demoSourceActive` is hard-wired false — the production build genuinely
cannot serve fixture data. `npm run build` still runs in `verify:all`, so the
production build is never left unverified.

## The credential-free suite

`npm run test:e2e:live` is the only configuration that proves the central
claim: **RideLens shows a real price with nothing configured.** It deliberately
does the opposite of the main suite —

- no fixture quote source and no fixture geocoder;
- a **production build**, where fixtures are structurally impossible to load;
- real calls to the public geocoder, the public router and the published rate
  cards.

It asserts that: no "no live source" banner appears; a Times Square → JFK
comparison returns a `taxi` card; the airport fare is labelled `UPFRONT_QUOTE`
and exceeds $70; the detail sheet itemises the fare, cites the rate card and
states the tolls/gratuity exclusion; a city trip renders as a band rather than
a single number; a Paris route shows **no price at all** and names the covered
markets; and `/api/health` reports `liveDataAvailable: true`. It also covers the live
shared-bike option being offered and held out of the ride ranking, the bike
detail naming a real station, the map drawing the route with its live station
legend, and the map expanding over the page and closing again, and the card and the detail
sheet agreeing about whether a quote can be booked — they disagreed once, and
that test exists so they cannot again. It also covers the covered-cities list
appearing before a route is entered, a one-directional charge appearing in only
one direction, and the party size changing the price where a city charges for
it.

It is slower and genuinely network-dependent, which is the point — a failure
here means the out-of-the-box experience is broken, not that a mock drifted.

## Live verification

`npm run verify:live` makes real external requests and prints request time,
response time, providers, products, prices, ETAs, quote types and freshness. It
never books a ride.

**Executed 2026-09-03:**

- **Location — LIVE VERIFIED.** Photon autocomplete returned 7 suggestions in
  513 ms; Nominatim resolved both endpoints in 1898 ms (including the mandatory
  ~1.1 s courtesy throttle); the JFK route measured 20.15 km.
- **Quotes — BLOCKED.** Every quote source reported its blocker code. No fixture
  data was substituted, in the script or in the product.

## Provider cross-check

**Not performed.** Comparing RideLens output against a provider's consumer app
at the same moment requires live quote credentials, which do not exist yet. When
they do: run `verify:live`, capture the timestamp, and manually check two or
three products against each provider's own app within the same minute. Automating
against consumer surfaces is out of scope — see `docs/SECURITY.md`.

## Accuracy metrics

`/admin` reports source disagreement (from `source_discrepancies`), quote age,
per-source latency and success rate. **No headline accuracy percentage is
published**, because there is no cross-check dataset to evidence one.

## What is not covered

- OAuth flows — no credential to exercise them against.
- Real provider payload shapes for Obi and Curb — fixtures encode the _expected_
  shape; the real one is unconfirmed.
- Deep-link prefill actually landing in the provider apps — needs a human with
  the apps installed. All handoffs ship `prefillVerification: 'UNVERIFIED'`
  precisely because this is untested.
- Load and soak testing.
