# Data Source & Access Matrix

**Verified: 2026-09-03.** Every row below was checked against primary sources on
that date, not recalled from memory. Re-verify before each release; provider
terms change without notice.

This document is the single authority for what RideLens may legitimately query.
If a source is not listed as permitted here, its adapter stays disabled.

---

## Summary

| Provider      | Data source                            | Method               | Live?                   | Price type                            | ETA?                    | Personalised? | Comparison permitted?                          | Partner approval?               | Booking               | Status                      | Verified   |
| ------------- | -------------------------------------- | -------------------- | ----------------------- | ------------------------------------- | ----------------------- | ------------- | ---------------------------------------------- | ------------------------------- | --------------------- | --------------------------- | ---------- |
| **Uber**      | Obi Intelligent Pricing                | Aggregator API       | Yes, once contracted    | Estimate / range                      | Yes                     | No            | Yes — via Obi's licence                        | **Required** (Obi)              | Deep link             | `PARTNER_APPROVAL_REQUIRED` | 2026-09-03 |
| **Uber**      | Uber Rides API `/v1.2/estimates/price` | Direct partner API   | Yes                     | `ESTIMATE_RANGE`                      | Yes (`/estimates/time`) | With OAuth    | **NO — prohibited by §II B**                   | Required (Uber BD)              | Deep link             | `POLICY_PROHIBITED`         | 2026-09-03 |
| **Lyft**      | Obi Intelligent Pricing                | Aggregator API       | Yes, once contracted    | Estimate / range                      | Yes                     | No            | Yes — via Obi's licence                        | **Required** (Obi)              | Universal link        | `PARTNER_APPROVAL_REQUIRED` | 2026-09-03 |
| **Lyft**      | Lyft Public API `/v1/cost`             | Direct partner API   | —                       | `ESTIMATE_RANGE`                      | Yes (`/v1/eta`)         | With OAuth    | Restricted                                     | **No route — programme closed** | Universal link        | `NO_PUBLIC_ENDPOINT`        | 2026-09-03 |
| **Empower**   | Obi Intelligent Pricing                | Aggregator API       | Yes, once contracted    | `ESTIMATE`                            | Yes                     | No            | Yes — via Obi's licence                        | **Required** (Obi)              | Generic handoff       | `PARTNER_APPROVAL_REQUIRED` | 2026-09-03 |
| **Empower**   | Empower partner API                    | Direct partner API   | —                       | `ESTIMATE`                            | Unknown                 | Unknown       | Unknown                                        | **No published programme**      | Generic handoff       | `NO_PUBLIC_ENDPOINT`        | 2026-09-03 |
| **Curb**      | Curb Flow                              | Direct partner API   | Yes, once contracted    | `UPFRONT_QUOTE` or `METERED_ESTIMATE` | Yes                     | No            | Yes — platform is built for third-party demand | **Required** (Curb BD)          | Partner URL / generic | `PARTNER_APPROVAL_REQUIRED` | 2026-09-03 |
| **Curb**      | Obi Intelligent Pricing                | Aggregator API       | Yes, once contracted    | Upfront / estimate                    | Yes                     | No            | Yes — via Obi's licence                        | Required (Obi)                  | Deep link             | `PARTNER_APPROVAL_REQUIRED` | 2026-09-03 |
| **Waymo**     | Obi Intelligent Pricing                | Aggregator API       | Yes, once contracted    | `UPFRONT_QUOTE`                       | Yes                     | No            | Yes — via Obi's licence                        | Required (Obi)                  | Generic handoff       | `PARTNER_APPROVAL_REQUIRED` | 2026-09-03 |
| **Geocoding** | Nominatim + Photon (OSM)               | Public HTTP, keyless | **Yes — verified live** | n/a                                   | n/a                     | n/a           | Yes, within OSMF usage policy                  | None                            | n/a                   | **`LIVE VERIFIED`**         | 2026-09-03 |
| **Geocoding** | Google Maps Platform                   | Direct API           | Yes                     | n/a                                   | n/a                     | n/a           | Yes                                            | Billing account                 | n/a                   | `MISSING_CREDENTIAL`        | 2026-09-03 |
| **Geocoding** | Mapbox                                 | Direct API           | Yes                     | n/a                                   | n/a                     | n/a           | Yes                                            | Billing account                 | n/a                   | `MISSING_CREDENTIAL`        | 2026-09-03 |

---

## Three sources that need no permission

RideLens has live prices out of the box because three kinds of data are
published rather than gated.

### 1. Regulated taxi

Every provider above prices by market forces behind an access-controlled API.
A **licensed taxi does not**: its fare is fixed by a public authority and
published as a rate card. Given that card and a measured route, the fare is
_computable_ — which is exactly what the meter in the cab is doing.

That makes regulated taxi the only live price RideLens can show with no
credential, no contract, and no provider access control touched. It is real,
not a proxy: for airport flat fares it is the **exact binding price**.

It is emphatically **not** a stand-in for Uber, Lyft or Empower. See
`docs/QUOTE_SEMANTICS.md` §"Regulated fares" for how the two are kept apart.

### 2. Regional rail

A taxi's rate card only governs trips that _start_ in its city, which leaves the
whole commuter shed unpriced — and suburb-to-city is one of the most ordinary
journeys there is. The railroad publishes a fare table for exactly that trip.

Operators publish two different shapes of table and RideLens carries both,
because modelling one as the other invents fares nobody wrote:

| Railroad    | Source                                                        | Shape                                                   | Stations | Verified   |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------- | -------- | ---------- |
| Metro-North | [mta.info](https://www.mta.info/fares-tolls/lirr-metro-north) | To/from Grand Central, zoned; peak and off-peak         | 112      | 2026-09-04 |
| Metra       | [metra.com/fare-table](https://www.metra.com/fare-table)      | Zone pair, any station to any station; one fare all day | 240      | 2026-09-04 |

**Fares are transcribed from the operator's fare page, never read from its
GTFS.** Both feeds carry fare files and Metra's is dated January 2024 against a
stops file rebuilt in July 2026 — 13% below the fares on its own live page as of
this writing. A feed is authoritative for geometry (where a station is, which
zone it is in, which trains call there, how long the run takes) and that is all
it is used for.

Three things a rail quote refuses to do:

- **Price a station the timetable barely serves.** Metra's O'Hare Transfer sits
  on the peak-only North Central Service with twelve entries in the whole
  timetable. A published fare for a train that is not running is not an option,
  so a trip either falls to a station that runs all day or is declined with the
  reason.
- **Price a pair no single train connects.** Naperville is on the BNSF and
  Glencoe on the UP North; both are real stations and no one train calls at
  both.
- **Pretend to be door-to-door.** The fare is the rail leg. The distance from
  each endpoint to its platform rides along with the quote and is stated on the
  card.

### 3. Shared bikes (GBFS)

GBFS — the General Bikeshare Feed Specification — is an open standard whose
entire purpose is letting trip-planning applications read a system's live
state. Cities routinely make publishing it a condition of an operator's permit.
Reading it is the intended use, not a workaround.

It is also the **most genuinely real-time** data in the product: station counts
change minute to minute and the feeds declare a 60-second TTL. A bike quote
names a specific station with a specific number of bikes in it right now, and
refuses to exist if no station within a short walk actually has one.

| System            | Operator | Markets           | Verified   |
| ----------------- | -------- | ----------------- | ---------- |
| Citi Bike         | Lyft     | New York          | 2026-09-04 |
| Divvy             | Lyft     | Chicago           | 2026-09-04 |
| Bay Wheels        | Lyft     | San Francisco Bay | 2026-09-04 |
| Capital Bikeshare | Lyft     | Washington, DC    | 2026-09-04 |
| Bluebikes         | Lyft     | Boston            | 2026-09-04 |

Two things a GBFS feed will happily hand you that are not a trip price:

- **A pass.** Philadelphia's Indego publishes only monthly products —
  Indego30 at $21.60, IndegoFlex at $10.00 — with no per-minute rate.
  `system_pricing_plans` is whatever the operator sells, not a fare table, so a
  plan now has to look like a single ride before it can price one. Indego is
  therefore not shipped: a system that could only ever decline to answer adds
  nothing.
- **Another vehicle.** Divvy publishes a scooter plan alongside its bike plan
  at the same $1.00 unlock but $0.44 a minute against $0.20. Nothing but the
  order of the array stood between the cheaper fare and one more than twice as
  high. Scooters are filtered out, and ties now break on the per-minute rate.

A bike quote is tied to the vehicle its plan prices. Citi Bike publishes exactly
one pricing plan and it is the **e-bike** one, so RideLens will not offer a Citi
Bike quote off a rack of twelve classic bikes and no electric — the price would
be real and the trip would not.

### A card applies where its regulator governs, not inside a rectangle

Market matching was a bounding box per city, and boxes do not respect state
lines. A rectangle drawn around New York City reaches across the Hudson, so a
pickup in **Newark** or **Jersey City** matched New York and was quoted on the
TLC meter — a New Jersey trip priced by a New York rate card and presented as a
regulated fare. Chicago's box reached north over Howard Street and did the same
to **Evanston**. Reagan National and Dulles, both in Virginia, matched the
District.

Those were not coverage gaps. They were confident wrong answers, which is the
one failure this product exists to prevent.

Each market now carries polygons of the territory its regulator actually
governs, plus exclusion rings for the enclaves a city wraps around but does not
govern — Oak Park and Cicero for Chicago. `tests/unit/jurisdiction.test.ts`
checks fifty real coordinates: thirty that must price, and twenty that must not.

The rings are deliberately conservative at the edges. Slightly small means
occasionally declining a trip we could have priced, which costs a quote.
Slightly large means pricing a trip in a jurisdiction that sets its own fares,
which costs the truth.

### Leaving the city the meter is written for

New York publishes two rules for trips that end outside the five boroughs, and
RideLens had neither:

- **Rate #04**, to Westchester or Nassau: metered normally to the city line,
  then **double the distance rate** beyond it. The engine splits the routed
  polyline at the boundary and charges each part correctly. Chelsea to Scarsdale
  went from $93.15 to $126.05 — the earlier figure was an undercharge of a third.
- **Rate #05**, anywhere further: a flat fare negotiated with the driver before
  the trip. There is no published number, so RideLens shows none.

A destination the card names by rule is unaffected: Newark Airport is in New
Jersey and outside the service area, but the TLC meters it normally and adds a
$20 surcharge, so it is neither doubled nor negotiated.

### Rate cards re-verified against the regulator, September 2026

Every card was read back against the authority's own page, and five real
pricing defects came out of it:

| Defect                                         | Effect                                                                        | Fixed                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Chicago airport departure tax billed both ways | **+$4.00** on every trip _to_ O'Hare or Midway                                | Pickup-only, as the card says ("applies to taxi fares leaving the airports") |
| San Francisco SFO fee billed both ways         | **+$6.00** on every trip _to_ SFO, which SFMTA states has no drop-off fee     | Pickup-only                                                                  |
| Boston Logan tunnel toll billed both ways      | **+$2.75** on every trip _from_ Logan                                         | Drop-off only ("from Boston proper to Logan Airport")                        |
| Newark $20 surcharge billed both ways          | Applied leaving EWR, where a yellow cab cannot legally pick up                | Drop-off only                                                                |
| DC emergency fuel surcharge always on          | **+$1.00** on every DC fare; it only applies during a declared fuel emergency | Removed                                                                      |

Three charges that were on the card and not in the code were added: Chicago's
per-passenger charge ($1.00 then $0.50), DC's ($1.00 each), and New York's
holiday exemption on the rush-hour surcharge.

Two markets could not be reached at all, because their airport sat outside the
market's own bounding box: a pickup at **SFO** or **Dulles** matched no rate
card and returned no fare. A test now asserts every zone a card names is inside
that card's box.

Note the operator: these are Lyft-run systems publishing openly. That is a live
price from Lyft's own infrastructure — and it is _not_ Lyft rideshare pricing,
which remains unavailable. A shared bike is a different mode and is kept out of
the vehicle comparison entirely.

Several feeds redirect a branded discovery URL to a shared Lyft host. The HTTP
client re-validates every redirect target against an allowlist rather than
following it blindly, so each system declares the hosts its feeds legitimately
live on — checked by hand on `verifiedOn`.

## The central finding

**Uber's and Lyft's own developer terms make a direct competitive comparison
product impossible, and Empower has no programme at all.** A licensed
aggregation layer is therefore not a convenience for RideLens — it is the only
lawful architecture for multi-provider Uber and Lyft coverage.

That is why `ObiQuoteSource` is the primary source and the direct adapters are
secondary, gated, and off by default.

---

## Uber

**Endpoint.** `GET https://api.uber.com/v1.2/estimates/price` returns
`product_id`, `display_name`, `localized_display_name`, `estimate`,
`low_estimate`, `high_estimate`, `currency_code`, `duration` (seconds),
`distance` (**miles**), `surge_multiplier`. `GET /v1.2/estimates/time` returns
pickup ETAs per product. Auth is a server token or an OAuth user token.

**Two independent blockers:**

1. **Access is gated.** Uber's documentation states that access to the price
   estimate endpoint requires approval from Uber and directs developers to
   their Uber business development representative. There is no self-serve path.

2. **Comparison is contractually prohibited.** Uber's API Terms of Use §II B
   bar using the API in a manner competitive to Uber, _including in connection
   with an application that features or supports a competing service_. Uber's
   own price-estimate documentation states that using the API to offer price
   comparisons with competitive third-party services violates those terms.
   Uber has enforced this: it cut off Urbanhail, a startup that compared Uber's
   real-time pricing and pickup times against competitors.

RideLens is precisely such an application. **We therefore do not create an Uber
developer account and call the estimates endpoint.**

**Implementation.** `UberAuthorizedQuoteSource` is written in full against the
documented contract, and refuses to execute unless the operator asserts
`UBER_COMPARISON_RIGHTS_GRANTED=true` — a statement that they hold a written
agreement granting comparison rights. Without that assertion the adapter reports
`POLICY_PROHIBITED` and issues **no network request at all**
(`tests/integration/adapters.test.ts` asserts zero calls).

**Booking deep links are a separate question.** The universal link
`https://m.uber.com/looking` with `client_id`, `pickup` and `drop[0]` (URL-encoded
JSON location objects) is a booking handoff, not a data API. It is used only when
`UBER_DEEPLINK_CLIENT_ID` is set; without it RideLens degrades to a generic
handoff rather than emitting parameters that would be silently ignored. Operators
should confirm with Uber that link attribution is acceptable for their product.

---

## Lyft

**Status: the public developer programme is closed.** `developer.lyft.com` no
longer accepts new applications, and Lyft's official Go and Node SDKs are both
marked deprecated and no longer supported by Lyft. There is no route by which a
new developer can obtain a Lyft cost-estimate credential today.

**Explicitly out of scope: third-party Lyft "data APIs".** Several vendors sell
scraped Lyft pricing. Those products access Lyft's consumer surface without
authorization. RideLens does not use them — not as a preference, but as a policy
boundary (see `docs/SECURITY.md` §Authorized access only).

**Implementation.** `LyftAuthorizedQuoteSource` implements the documented
`/v1/cost` and `/v1/eta` contract, including the client-credentials grant, so a
partner credential activates it with configuration alone. One detail matters:
Lyft reports money in **minor units already** (`estimated_cost_cents_min` /
`_max`), so those values bypass `majorToMinor` entirely. A test pins this.

**Booking.** `https://lyft.com/ride?id=…&partner=…&pickup[latitude]=…&
destination[latitude]=…` is the current universal link; riders without the app
land on `ride.lyft.com`. It requires a Client ID from the Lyft Developer
Program, which is the same closed programme — so in practice RideLens ships the
generic `ride.lyft.com` handoff.

**Note.** Lyft and Curb announced a partnership integrating taxi ride requests
into Curb Flow — Lyft is a _consumer_ of Curb Flow, not a provider through it.
This does not give RideLens a path to Lyft pricing.

---

## Empower

**Identity check first.** Empower here is the driver-owned rideshare platform
(iOS/Android "Empower — Your ride, your way"), where drivers keep the full fare
and set their own rates. It is **unrelated to `empower.com`**, the retirement and
financial-services company that publishes a public API programme. Wiring the
financial company's endpoints into a rideshare adapter would be a serious and
easily-made error; the adapter file carries this warning at the top.

**Status.** No developer portal, no partner API documentation, no published
OAuth flow, and no documented deep-link scheme.

**Price semantics — the important part.** Empower is a driver-priced
marketplace. The number a rider sees before a driver accepts is a **prediction of
what a driver will charge**, not a fare Empower has committed to. RideLens
therefore hard-codes `ESTIMATE` for Empower and will emit `UPFRONT_QUOTE` **only**
if a payload carries an explicit `fare_is_guaranteed: true`. Two tests pin both
halves of this.

**Booking.** No deep link exists. RideLens shows the interstitial with the
pickup, destination and observed price so the rider can re-enter them.

---

## Curb

**Curb Flow is real and is the most promising direct source.** It unifies street
hails, fleet dispatch, app bookings and third-party demand across 100+ US cities
and 100k+ vehicles, and names Uber, Lyft and Ride Health among its integration
partners. Unlike Uber and Lyft, Curb's platform is _designed_ to accept ride
demand from third-party applications — so a comparison product is a natural fit
rather than a terms conflict.

**Access.** Not self-serve. `gocurb.com/curb-flow` directs interested parties to
contact the Curb team; there is no public developer portal or documented schema.

**Price semantics.** Curb offers upfront pricing in some markets and metered
fares in others. `CurbFlowQuoteSource` emits `UPFRONT_QUOTE` only when the
payload carries an upfront fare, and `METERED_ESTIMATE` or `ESTIMATE_RANGE`
otherwise. Category is always `TAXI` (or `ACCESSIBLE`): a regulated metered
vehicle is a different product from an app STANDARD car and is never folded into
`STANDARD`. It still appears in the **Best** view, because riders care about
price across those categories.

**Schema caveat.** The request/response shapes in `CurbFlowQuoteSource` are
inferred, not vendor-documented. They are confined to that one file and
validated by Zod; confirm them against Curb's real documentation at onboarding.

---

## Obi — the primary source

Obi (`rideobi.com`) operates a consumer rideshare and taxi comparison app across
175+ countries covering Uber, Curb, Bolt, Careem, inDrive, Waymo, Tesla, Cabify,
Ola, FreeNow and others, and licenses the underlying feed as the **Intelligent
Pricing API**.

The API is a real, working product with a track record: Obi's Intelligent
Pricing API supplied the data for a Bloomberg News investigation into NYC driver
lockouts and surge pricing, and for Obi's own 2026 side-by-side analysis of
Waymo and Tesla pricing, pickup times and availability measured against Uber and
Lyft across the San Francisco Bay Area (data collected 1 March – 14 April 2026).
That analysis demonstrates exactly the capability RideLens needs: simultaneous,
comparable, multi-provider live pricing and ETAs.

**Access.** Commercial agreement. Obi publishes no self-serve developer portal;
enquiries go through their contact channel. See `SETUP_REQUIRED.md` §Obi for the
exact request to make.

**Schema caveat.** Obi does not publish the API schema. `src/sources/obi/schema.ts`
is written permissively (it accepts several common envelope and price shapes) and
is the **only** file that knows Obi's field names. Run
`npm run verify:live -- --dump obi` with a real key to capture the true payload,
then tighten that one file.

**Do not scrape Obi.** RideLens uses a commercial API relationship only. The
consumer app is not a data source.

---

## Geocoding

RideLens resolves each endpoint **once**, with **one** provider, and hands the
identical coordinates to every quote source. Geocoding the same address twice
with two providers would put Uber's pickup metres away from Lyft's and quietly
invalidate the whole comparison.

| Provider                     | Key      | Autocomplete        | Rate limit   | Chosen when                                         |
| ---------------------------- | -------- | ------------------- | ------------ | --------------------------------------------------- |
| Google Maps Platform         | required | Places Autocomplete | high         | `LOCATION_PROVIDER_API_KEY` set                     |
| Mapbox                       | required | Search Box          | high         | key set and `NEXT_PUBLIC_MAP_KEY` is a `pk.*` token |
| **Nominatim + Photon (OSM)** | **none** | Photon              | **~1 req/s** | default fallback                                    |

**Why keyless OSM is the default, and its honest limitation.** It let RideLens
ship with a genuinely live, verified location layer before any commercial
contract exists — `npm run verify:live` performs real requests against both
services and this has been executed successfully. It is permitted for low-volume
use provided requests carry an identifying User-Agent and stay near one per
second; `OsmGeocoder` enforces both. **It is not adequate for consumer scale**,
and `startupChecks` emits `KEYLESS_GEOCODER` to say so on every boot. Set
`LOCATION_PROVIDER_API_KEY` before real traffic.

---

## Published rate cards

Transcribed from each regulator's own schedule into
`src/sources/ratecard/tariffs.ts`, with `authority`, `sourceUrl` and
`verifiedOn` on every card so a wrong figure is traceable to a source rather
than to someone's memory.

| Market         | Authority              | Key figures                                                                                                                                                                                                                                                                       | Verified   |
| -------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| New York City  | NYC TLC                | $3.00 initial; 70¢ per 1/5 mi or per 60 s below 12 mph; **JFK ↔ Manhattan $70 flat**; $1.00 improvement; 50¢ MTA; $2.50 congestion below 96th; 75¢ MTA toll below 60th; $2.50 weekday rush 4–8pm ($5.00 on airport flat fares); $1.00 overnight 8pm–6am; LGA +$5.00; EWR +$20.00 | 2026-09-04 |
| Chicago        | City of Chicago (BACP) | $3.25 flag for first 1/9 mi; **31¢ per 1/9 mi**; 31¢ per 45 s; $2.50 rush 3:30–7pm; $1.00 overnight 8pm–6am; $4.00 airport departure tax                                                                                                                                          | 2026-09-04 |
| Washington, DC | DC DFHV                | $4.00 first 1/8 mi; $2.56 per mile (32¢ per 1/8 mi); $25/hr wait; 50¢ passenger; $1.00 fuel                                                                                                                                                                                       | 2026-09-04 |
| San Francisco  | SFMTA                  | $4.15 first 1/5 mi; 65¢ per 1/5 mi; 65¢ per waiting minute; SFO pickup +$6.00                                                                                                                                                                                                     | 2026-09-04 |

**These change by rulemaking, without notice to anyone downstream.** Chicago's
card was rewritten effective 1 July 2026 — the first increase in a decade — and
a stale transcription would have understated every Chicago fare by roughly a
fifth. Re-verify on the schedule below.

Outside these five markets the source returns **no quote and says so**, naming
the markets it does cover. It never extrapolates one city's tariff onto
another.

**Deliberately not shipped: Los Angeles.** LADOT blocks automated access to its
rate sheet, and the secondary sources disagree on the per-mile figure ($2.80 vs
$2.97). A card nobody can check against the regulator is worse than no card at
all, so the gap is recorded here rather than filled with a guess.

### What the fare does and does not include

Included: initial charge, distance units, time-based units where the meter
charges them, and every surcharge whose condition holds at the market's current
local time.

Excluded, always stated on the quote: **tolls and gratuity**. Both are added at
the end of a real trip and neither is knowable in advance from a rate card.

## Re-verification checklist

Before each release, re-confirm and update the _Verified_ column:

1. Uber API Terms of Use §II B and the price-estimate documentation's
   competitive-comparison note.
2. Whether `developer.lyft.com` has reopened to new applications.
3. Whether Empower has published any developer or partner programme.
4. Curb Flow partner terms and the real request/response schema.
5. Obi Intelligent Pricing contract scope, rate limits and per-call pricing.
6. Deep-link syntax for every provider — these change silently and break
   prefill without any error.
7. **Every published rate card**, against the regulator's own page.
8. **Every GBFS discovery URL and its redirect target**, since a feed moving
   host would otherwise be blocked by the SSRF allowlist and look like an
   outage. Update
   `verifiedOn` when checked, even if nothing changed — a stale date is a
   signal, and an un-updated one hides a card nobody has looked at in a year.
