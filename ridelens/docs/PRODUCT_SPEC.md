# Product Spec

**RideLens — Every ride. One live comparison.**

## What it is

A rider enters where they are and where they are going. RideLens fetches the
freshest legitimately accessible live prices and pickup ETAs across competing
ride providers, normalises them, compares equivalent ride types, ranks them
honestly, and hands the rider into the chosen provider's booking flow.

It is a **utility**. The data is the interface.

## What it refuses to do

This list is the product, as much as the feature list is:

- show a midpoint where the provider gave a range
- call an estimate an upfront fare
- show an expired quote as current
- substitute a stale or invented price for a failed provider
- claim a saving against something the rider cannot book
- claim a field is prefilled in a booking link that has not been tested
- put a luxury car in the cheapest standard comparison
- publish an accuracy figure it cannot evidence

## Priority order

When these conflict, the higher one wins:

1. live-data integrity
2. quote truthfulness
3. correct provider comparison
4. reliable booking handoff
5. speed
6. mobile usability
7. visual polish

Nothing in 1–4 is traded for 7.

## Core flow

```
RideLens
Where are you going?

[ PICKUP        ]   ← "Use current location" only on an explicit press
      ↓
[ DESTINATION   ]   ← autocomplete: airports, venues, addresses, landmarks

[ COMPARE RIDES ]
```

On submit: canonicalise the route → create a `QuoteSession` → discover enabled
sources → fire all requests concurrently → normalise as each arrives →
reconcile duplicates → rank → render.

## Results

**Hero — the cheapest sensible ride,** with a headline the comparator can
actually justify: "Best price" when the claim is definite, "Likely cheapest"
when it rests on a wide range, "Similar price" when two options are
indistinguishable.

```
BEST PRICE
Empower  Everyday                    Standard
$23.84  Est.
4 min pickup · 32 min trip · Live estimate
Save $9.12 vs UberX
                                    [ Book Empower ]
```

**All options,** aligned on the same grid so prices and ETAs line up down the
list:

```
Curb    Curb Taxi        $27.20  Upfront   3 min   +$3.36
Lyft    Lyft             $29.92  Est.      5 min   +$6.08
Uber    UberX            $27–34  Est.      2 min   Similar price
```

Below that, only if something went wrong: **"Not included in this comparison"**,
naming each affected provider and why.

### Every card answers five questions

**WHO** · **HOW MUCH** · **HOW SOON** · **WHAT TYPE** · **HOW FRESH**

Price is visually dominant. ETA is secondary. Badges are minimal. Freshness is
never omitted.

## Ride taxonomy

`STANDARD` `ECONOMY` `TAXI` `XL` `PREMIUM` `LUXURY` `EV` `SHARED` `ACCESSIBLE`
`AUTONOMOUS` `OTHER`

Unverified products map to `OTHER` and stay out of the default view. A wrong
`STANDARD` mapping puts a luxury car in the cheapest comparison — the failure is
asymmetric, so the default is conservative.

## Filters and sorting

**Filters:** Best · Standard · XL · Premium · Taxi · All.
Empty filters are disabled rather than hidden, so the rider can see the shape of
what is available.

**Best** answers _"what is the sensible cheapest ride for me right now?"_ — it
includes standard, economy and **taxi**, because riders care about price across
those. It excludes XL, premium and luxury, which are a different purchase.

**Sorts:** Cheapest (default) · Fastest pickup · Best value.

_Best value_ is a published rule, not a model: price plus $0.25 per minute of
pickup wait. The formula is printed on screen when the sort is active. No "AI
scoring".

When the cheapest ride is not the fastest, RideLens says so in one line rather
than hiding it: _"Fastest pickup is Uber UberX at 2 min."_

## Freshness and refresh

Every card carries its freshness, re-derived every second so it ages on screen.
"Live estimate" while fresh, then "12 sec ago", then a warning tone, then
_"This quote expired. Refresh for a current price."_

Where a provider supplies an expiry, the card counts it down: _"Quote expires in
1:24."_

**Refresh prices** is prominent, with _"Updated 18 sec ago"_ beside it. On
refresh, changed prices show a small ↑/↓ delta against the previous run. There
is no automatic polling: it would spend the rider's provider quota and the
operator's API budget without being asked.

## Booking handoff

Three honesty levels, and the UI never overstates which one it has:

| Kind                 | When                                                 | Behaviour                                   |
| -------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `PREFILLED_DEEPLINK` | RideLens built the link from documented syntax       | Opens the provider with the route filled in |
| `PARTIAL_DEEPLINK`   | The source supplied a link that passed the allowlist | Opens it; claims nothing about prefill      |
| `GENERIC`            | No documented deep link exists                       | Interstitial, then the provider's site      |

Every handoff ships `prefillVerification: 'UNVERIFIED'` until a human confirms
the prefill actually lands in that provider's app.

The interstitial restates what the rider is committing to:

```
You selected
Empower Everyday

Pickup        14 Prince St, New York
Destination   JFK Airport Terminal 4
Observed      $23.84 · Est.
Updated       8 sec ago

Empower confirms the final fare in its own app. Your account there may also
show promotions or credits that RideLens cannot see.

[ Back ]              [ Continue to Empower ]
```

## Anonymous first

The first comparison requires no account. Authentication is optional, and only
for saved places, history, connected accounts and preferences. There is no
signup wall anywhere in the first-run path, and an E2E test asserts it.

## Ride detail — showing the working

Every card opens a detail panel that answers _why_: what kind of number this
is and what that means in a sentence, how wide the band is, which source sent
it, whether it is a public or account price, when it arrived and when it
expires, how many seats it typically has, what the booking link will actually
prefill — and, when more than one source priced the same product, the
candidates reconciliation rejected and by how much they disagreed.

A comparison product that cannot explain itself is asking for trust it has not
earned.

## Sharing a comparison

Share mints an opaque link — `/s/k3m9x2vq7bnd` — that carries no coordinates
and no prices. Opening it restores the route and runs a **fresh** comparison.

The recipient never sees the sender's fare, because a fare from an hour ago is
a memory. Links expire after 30 days.

The booking interstitial can also copy a plain-text trip summary for expensing,
which always states that the provider confirms the final fare.

## Splitting the fare

The detail panel splits the observed price between up to eight people, in whole
cents, with the remainder handed to the earliest payers so the parts always add
back to the total exactly. `$28.46` between three is `$9.49 / $9.49 / $9.48` —
never three lots of `$9.49`, which would invent a cent.

## Passengers

A party-size control filters to vehicles that seat the group. Seat counts are
RideLens's own model, not provider data, so the control says so and filters
conservatively — hiding an option is a better failure than seating five people
in a four-seat car.

## Auto-refresh

Off by default and hedged four ways: opt-in, paused whenever the tab is hidden,
hard-stopped after 12 cycles, and on an interval well above the cache TTL. The
countdown is shown, not hidden, so the rider always knows what is about to
happen on their behalf.

Auto-polling a paid quote API is a good way to spend someone else's money.

## Price movement

Once a screen has been refreshed at least once, a compact sparkline shows the
cheapest bookable price across those refreshes, so a rider can see the market
move while they decide. Scoped to the session: RideLens keeps no long-term
price analytics.

## Keyboard

`/` or `⌘K` focuses the search, `R` refreshes, `?` lists the shortcuts, `Esc`
closes any panel. Shortcuts never fire while a field or dialog has focus.

## Recent routes

Anonymous visitors get their recent routes and saved Home/Work back as quick
picks in the address dropdown — one keystroke for the common case. All of it is
stored **only in their own browser** and cleared with one visible control. No fare is stored with a route:
a price from an hour ago says nothing about now, and showing one would be the
clearest possible violation of the product's promise.

Signed-in history would live in `recent_searches`, which is owner-only and
owner-deletable.

## Location UX and privacy

Pickup defaults to "Current Location" **only** if the rider presses the button
and the browser grants permission. Denial is a normal path, not an error state —
search remains fully usable.

Precise coordinates never enter logs or generic analytics; sessions store
coarse (~1 km) coordinates; history is user-owned and user-deletable. Saved
Home/Work exist only if the rider explicitly creates them.

## Design

Premium transport/fintech: crisp, dense, quiet. Strong typographic hierarchy,
tabular numerals so prices never shift width, precise spacing, cards aligned on
a shared grid, brand colour limited to a 3 px rail.

Explicitly rejected: KPI card rows, gradients, AI sparkles, fake assistants, 3D
cars, floating spheres, blur, glassmorphism, decorative charts.

Motion is restrained: skeletons while sources are in flight, a 180 ms fade as
each result lands, a small highlight when the cheapest changes. Nothing moves
that is not communicating a state change.

## Responsive

**390 px is a first-class target.** Sticky route summary and Refresh, large tap
targets (≥44 px), no horizontal scroll, no tables requiring zoom.

**Desktop (≥1024 px)** puts the route form and map in a sticky left rail with
results in the main pane.

## Accessibility

ARIA 1.2 combobox for address entry with full keyboard support. Visible focus
everywhere. Screen-reader price descriptions speak currency in words —
_"UberX: estimated between 27 dollars and 34 dollars"_ — and speak a range as a
range, never as a midpoint. `prefers-reduced-motion` disables all animation.

## Operator surfaces

`/admin` — per-source status, blocker codes, calls, cache hits, errors,
timeouts, p50/p95, success rate, and modelled cost labelled as an estimate.

`/api/health` — public, and states plainly whether the deployment can produce
live data at all.

## Current status

RideLens is complete and tested end to end. **No live quote source is currently
connected**, because every provider in scope requires a commercial agreement or
prohibits competitive comparison outright (see `docs/DATA_SOURCE_MATRIX.md`).

The product says so rather than pretending: the home page shows the specific
blocker, `/api/health` reports `liveDataAvailable: false`, and a comparison
returns `503 NO_SOURCE_CONFIGURED`. The location layer **is** live and verified.

See `SETUP_REQUIRED.md` for the exact requests that turn each provider on.
