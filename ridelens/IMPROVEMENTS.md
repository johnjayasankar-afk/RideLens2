# Improvement log

One entry per cycle, newest first. Each records what shipped and why, what was
actually verified, what is still missing, and where the next cycle should look.
Read it for context, then re-check the priorities against the product as it
now stands — the list at the bottom is a starting point, not a plan.

---

## Cycle 6 — A trip has two ends

### What opening the product showed

The logged priority was "a routed walk to the boarding point", and it was right
— but running the product first turned up something larger sitting underneath
it. The Loop to O'Hare published this metadata:

```
board  Chicago Union Station   1358 m
alight Bensenville             3447 m      ← never shown anywhere
```

Metra's Milwaukee West line stops at **Bensenville**. The O'Hare terminal is
3.4 km further on. The card read "Board at Chicago Union Station · 37 min trip"
and never named the station the rider actually gets off at, so the obvious
reading was that the $5.50 fare goes to the airport. It does not. And the
verdict bar shipped last cycle announced "About 54 min all in", having counted
the walk at one end and dropped the larger one at the other.

Scarsdale to Chelsea was the same shape: "Board at Hartsdale · 49 min trip",
with no distance to Hartsdale and no mention that Grand Central is 1.7 mi from
Chelsea.

So the cycle became the thing the routed walk was in service of: **a trip has
two ends, and the product must account for both or stop claiming a total.**

### The router, and why it needed its own client

The existing `routing.ts` talks to the public OSRM demo server. That server
accepts `/route/v1/walking/` and `/route/v1/foot/` and answers with the driving
graph regardless — measured, on the Loop→Union Station leg: **2132 m in 248 s,
which is 31 km/h**. Believing it would have turned a twenty-minute walk into a
four-minute one and made the product's most prominent claim far worse than the
straight line it replaced.

Walking therefore gets `src/location/walking.ts`, pointed at the public
Valhalla instance, which has a real pedestrian graph. The same leg: **1815 m in
1349 s** — 1.35 m/s, 1.28× the straight line. Two other candidates were tested
and rejected: FOSSGIS's OSRM `foot` profile returned 3770 m for that leg, 2.6×
the straight line and not credible.

What it changed in practice:

| leg                      | straight line | routed     |          |
| ------------------------ | ------------- | ---------- | -------- |
| The Loop → Union Station | 1358 m        | **1766 m** | +30%     |
| Scarsdale → Hartsdale    | 1003 m        | **1897 m** | **+89%** |

### What shipped

**`src/domain/journey.ts`** — legs, not a number. A total is claimed only when
every leg is known and walkable; `null` is a refusal rather than a missing
value. `BOARD_TOO_FAR`, `ALIGHT_TOO_FAR` and `BOTH_TOO_FAR` are distinguished
because they are different problems: a station you cannot walk _to_ still gets
you there, one you cannot walk _from_ does not.

**A journey strip**, drawn to scale, on the card and in the verdict. The walk
is a third of the Chicago bar, and the stretch the fare does not cover is drawn
**open** — hatched rather than tinted, so it reads as absence without relying
on hue. Its width is fixed rather than proportional on purpose: sizing it by
the walk we estimated would assert that the rider walks it, and the whole point
is that the product does not know how it gets covered.

**The verdict stops calling it a saving when it is not one.** A $5.50 fare to
Bensenville against a $58.43 cab to the terminal is not "$52.93 less" — those
are two different journeys, and subtracting their prices is the same category
error as subtracting two currencies, which this module already refused to do
two lines further down. The money still leads, because $5.50 against $59 is
worth knowing. The word does not.

**The detail sheet itemises every leg** — `Get on at` / `On board` /
`Get off at` / `Door to door` — and cites where each walk figure came from.

**A bike's walks are never counted twice.** Its published duration is already
door to door, so its ride leg is the remainder and the total comes back to
exactly the operator's own figure.

### The second critique, and what it changed

Measuring the strip rather than eyeballing it caught the walk segment rendering
at `rgb(47,54,65)` — `--border-strong`, effectively invisible on the dark
panel, which is an odd fate for the leg the whole cycle exists to stop the
product hiding. Now a mid neutral that holds in both themes.

The substantive one: I built a pedestrian router so the walk would be
_measured_, and then the surface a rider reads did not distinguish a
measurement from a guess. With the router down, every walk silently degrades to
a straight line that is systematically a quarter to a half short, and the card
would have looked identical — a failed integration in hiding, which is the one
thing this product's own rules forbid.

The fix is also a sharper claim than the hedge it replaced. A straight line is
the _shortest path that could possibly exist_, so a paced straight-line time is
not an approximation — it is a **floor**. The copy now says "at least 17 min
walk" and "at least 54 min door to door" for an unrouted leg, and drops the
qualifier entirely for a measured one. That tells the reader which way the
number moves, and reports the router's absence without making anyone read a
status page.

### Two defects the live suite caught that no unit test did

**Both ends unwalkable reported only one.** The first cut asked a single `gap`
value which end was the problem, which works until the answer is "both" — and
then a Scarsdale side street to Chelsea rendered as "49 min on board to Grand
Central — which leaves you 1.7 mi short", with no hint that the boarding
station was two miles the other way. Both the strip and the sentence are now
leg-driven: each leg answers for itself.

**Two uncached external calls on the critical path of every rail quote.** The
live suite prices the same four trips dozens of times and went from 3 minutes
to 12.8, with timeouts. Footpaths are not fares — the quote cache lives for
tens of seconds because a surge price does, while a pavement changes on the
timescale of a construction project. Walks now cache for six hours, bounded at
2000 entries, with in-flight deduplication so a burst of rail quotes produces
one request rather than one per rider.

### What was verified

- 615 unit and integration tests across 40 files. 23 on the journey model
  (totals, refusals, both-ends, bike double-counting, segment proportions,
  every sentence) and 10 on the router (fallback on timeout, on a malformed
  response, and on a geometrically impossible route; no request spent on an
  unwalkable distance; cache hits, in-flight collapse, failure backoff, grid
  quantisation).
- Lint, types, Prettier, production build clean.
- Live, in a browser, against the real routers: Chicago reads _"$5.50 by
  regional rail, but it stops 2.1 mi short of O'Hare Airport. A licensed taxi
  is $59.43 and goes to the door."_ Scarsdale reads _"23 min walk to
  Hartsdale, 49 min on board to Grand Central — which leaves you 1.7 mi short
  of Chelsea, Manhattan."_ The detail sheet shows `Get on at Hartsdale — 23 min
walk, 1.2 mi (measured walking route)` and `Door to door — Not stated, this
fare does not cover the whole trip`.
- Strip proportions measured, not eyeballed: 28.4% / 48.4% / 22.0% against a
  design of 28.4 / 48.4 / 22. Zero horizontal overflow at 375px. Both themes
  checked for the three segment fills.

### Limitations

- **The walk is one router's opinion**, from a public instance intended for
  light use. `WALKING_BASE_URL` points it elsewhere; the fallback is honest and
  labelled when it does not answer.
- **The 2 km walkable threshold is a judgement**, not a measurement. Grand
  Central to Chelsea at 2.7 km is over it and some riders would walk it.
- **The product still does not price the last mile.** It says "1.7 mi short of
  Chelsea" and stops there, which is honest but incomplete — and it already has
  a New York rate card that could price exactly that leg.
- The gap's width is fixed, so 1.7 mi and 10 mi draw identically. The distance
  is in the sentence; the bar only says "there is a piece missing".

### Where the next cycle should look

1. **Price the last mile.** The obvious next question after "leaves you 1.7 mi
   short of Chelsea" is "so what does that cost?" — and RideLens holds the New
   York rate card that answers it. A rail fare plus a short metered leg is a
   real door-to-door price, and it would turn the honest refusal this cycle
   shipped into a complete answer.
2. **Comparing destinations.** Still unbuilt: JFK vs LGA vs EWR from one pickup.
3. **Scheduling beyond 24 hours** — the tariff engine can price it; the
   planner's window cannot reach it.
4. **Walkability as a rider preference.** The 2 km line is the product's
   opinion imposed on everyone; some people walk 5 km cheerfully.

---

## Cycle 5 — The page knew the answer and would not say it

### Why this, and not the logged priority

The log put comparing destinations first. Opening the product decided
otherwise inside ten seconds: The Loop → O'Hare returned a **$58.43** metered
cab as the hero, in the largest type on the screen, under a badge reading
**ONLY OPTION** — while a **$5.50** Metra fare sat one scroll below it under a
heading explaining that it had been kept out of the ranking.

Every number was right. Every source was cited. The badge was false, the
emphasis was inverted, and the one act of synthesis the product exists to
perform was left to the rider. Adding a fourth feature on top of that would
have been decorating around a lie.

### What shipped

**A verdict, said once, at the top.** When the cheapest way to make the trip is
not the one leading the ride ranking, a bar above the results names it: the
winning fare in the largest type it has earned, the saving, the losing fare,
where you board, how far that is, and how long it takes.

It is deliberately quiet. It appears only when the saving clears a fifth of the
car fare — a _share_ rather than an amount, because the same dollar means
different things against $6 and against $60 — and it says nothing at all on a
trip whose hero is already the cheapest option. A banner that fires on every
comparison is a banner, and a banner gets scrolled past.

**The badge tells the truth.** `ONLY OPTION` now appears only when nothing else
answered at all. When another mode is on the page it reads `ONLY CAR`, which
is what it actually means.

**Both sides are filtered the same way.** Writing the tests found a real defect:
the cheapest car was checked for availability and the winner was not, so a
docking station with no bikes left in it could have been announced as the
cheapest way to make the trip. Both sides now pass the same bar — and the
behaviour was confirmed in the browser when a bike quote expired mid-session
and the verdict withdrew itself rather than recommend a stale price.

**Mode-aware words.** A bike does not run to a timetable and a train is not
waiting for you. `The nearest bike is at …` and `Leaves from …` are chosen by
mode; the first draft told a rider a shared bike takes "34 min on the
timetable".

### The second critique, and what it changed

The finished bar read:

> Leaves from Chicago Union Station, 0.8 mi from your pickup.
> **37 min on the timetable, against 44 min by road.**

Both figures were true, each was labelled with what it measured, and the
sentence before it gave the distance. It was still misleading, and the
component's own doc comment had congratulated it for refusing to subtract them.

Two numbers placed side by side get subtracted whatever the labels say. The
walk to Union Station is about sixteen minutes; the trip is **53 minutes
against 44**. The train is cheaper _and slower_, and the page was quietly
implying the opposite on its most prominent claim.

Refusing to do the arithmetic is not the same as being honest about it. So:

- The walk goes **in**, at a stated pace (1.35 m/s, about 3 mph), hedged with
  "about" every time it appears. It now reads _"About 54 min all in — 37 on the
  timetable and about 17 walking to the platform, against 44 min by road."_
- The parts are summed **after** rounding, so a reader who checks the addition
  finds that it holds.
- Beyond 2 km nobody walks to a station, so no total is claimed — the line
  describes the access instead (_"once you have covered the 4.2 mi to the
  station"_) and the road figure is **withdrawn with it**, because there is no
  honest comparison left to make.
- A bike is exempt: its quote is already door to door, so nothing is added.

### What was verified

- 587 unit and integration tests across 38 files, 17 of them on the verdict:
  saving detection, the materiality threshold, cross-currency refusal,
  unavailable-option exclusion on both sides, the mode-aware copy, the walk
  arithmetic, the unwalkable case, and that the printed parts add up.
- 105 fixture E2E and 33 credential-free E2E against a production build. Six
  are new and run on live data, asserting the _relationships_ between the
  numbers on screen rather than the numbers themselves: the saving equals the
  difference of the two prices printed, the saving clears the threshold, an
  all-in total accompanies any walkable access distance, the parts sum to it,
  "Show it" opens the winner and moves focus into the dialog, and a trip whose
  hero is already cheapest shows no verdict at all.
- Lint, types, Prettier clean.
- In a real browser on live data: Chicago reads _"$5.50 — by regional rail —
  $52.93 less than a licensed taxi at $58.43. Leaves from Chicago Union
  Station, 0.8 mi from your pickup. About 54 min all in — 37 on the timetable
  and about 17 walking to the platform, against 44 min by road."_ Washington
  reads _"$4.30 — by shared bike — $9.16 less … The nearest bike is at 20th &
  O St NW / Dupont South, a few steps from your pickup. 34 min door to door,
  walk included, against 8 min by road."_ Times Square → JFK shows no verdict.
- Measured at 375px, not eyeballed: zero horizontal overflow, 44px "Show it"
  target.

### Limitations

- **The walk is an assumption.** 1.35 m/s is the ordinary planning figure, not
  this rider's pace, and the distance is straight-line access rather than a
  routed footpath. Both are stated as "about". A routed walk would be better
  and is a real next step.
- **The road figure is free-flow.** It is the routing service's estimate, not a
  live-traffic one, so the car side is optimistic at rush hour — which makes
  the comparison conservative in the train's disfavour, not its favour.
- **One winner only.** If both a train and a bike beat the car, the bar names
  the cheaper and the other stays below.
- **Nothing is said about the return.** A verdict on the outbound leg may not
  hold at midnight when the timetable has thinned out.

### Where the next cycle should look

1. **A routed walk to the boarding point.** The access distance is straight
   line, and the walk is now load-bearing — it decides which mode the page
   says is faster. The routing service already answers walking profiles.
2. **Comparing destinations.** Still unbuilt, still one query away: JFK vs LGA
   vs EWR from one pickup would make the airport case decisive.
3. **Scheduling beyond 24 hours.** "I fly Tuesday at 6am" — the tariff engine
   can already price it; the planner's window cannot reach it.
4. **Metra's second dimension.** A flat fare does not move on a clock but does
   move by zone: "walk two stops and save" is the equivalent insight.

---

## Cycle 4 — The first screen shows a fare instead of describing one

### Why this, at last

Three cycles running, the log put the dead start first and three cycles running
something else won. That is itself a signal, and the fourth time it was simply
the biggest thing left: until a rider typed two addresses, RideLens showed
nothing but prose about its own methodology — an answer to "why should I trust
this?" delivered before anybody had asked, and before a single number had
appeared. Everything the product is persuasive about was one form submission
away, and the form was empty.

### What shipped

**Four real trips, one tap each.** Times Square → JFK, Dupont Circle → the
Capitol, Scarsdale → Chelsea, The Loop → O'Hare. Tapping one fills the fields
and runs the ordinary path: the live geocoder resolves the coordinates, the
live routing service measures the route, the city's own tariff prices it. They
are not demonstration data and the screen says so — if a rate card changes
tonight they change with it, and if a source is down they fail exactly as a
typed trip would.

Each was chosen to show something different, so the set reads as a tour rather
than a list of cities:

| Trip                        | What came back                                |
| --------------------------- | --------------------------------------------- |
| Times Square → JFK          | taxi $74.75 — a flat fare, exact by rule      |
| Dupont Circle → the Capitol | bike $4.30 beside taxi $13.46                 |
| Scarsdale → Chelsea         | train $10.25; the cab declines, with the rule |
| The Loop → O'Hare           | train $5.50 against taxi $58.43               |

**The screen was re-ordered: show, then cover, then explain.** The three
methodology points moved out of the hero and to the bottom, set as a compact
row rather than a numbered list. They are the answer to a question the fare
itself provokes, so they now come after it.

**The fields stay filled.** The point of starting somebody somewhere is that
they can edit it into their own trip rather than clear it and retype.

**Clearing both endpoints starts over.** Found in the self-critique pass: the
tour was one-shot, because once an example had run the first screen was gone
and there was no way back to the other three. Emptying both fields is an
unambiguous "start over", so the results now go with them — which also removes
a stale priced comparison sitting under two empty fields. Clearing one end
still means editing that end.

### Verified

- 570 unit and integration tests (from 565). Five new ones guard the examples
  against becoming dead links: every pickup still falls inside a market that
  can price it, the refusal example still refuses, the row text stays short
  enough not to ellipsise, and the accessible name still contains the visible
  words (WCAG 2.5.3).
- 105 fixture E2E (two new, one per project, for starting over); 28
  credential-free E2E against a production build, three new: a first-time
  visitor sees a real fare in one tap, the refusal example still shows a
  refusal, and _every_ example comes back with a price.
- In a real browser: all four examples return live prices, and the four rows
  are real buttons at 57px, tabbable, with spoken names.
- Layout measured at 375px and 1180px.

A third defect, in the tests rather than the product: the dark-scheme
accessibility audit flaked on the empty form, reporting `--text-4` at 4.1:1
when the token is 4.86:1 against that surface. axe was sampling a frame of the
`.enter` animation and measuring _composited_ colour. The audit now finishes
every running animation before it runs, so it measures what a reader actually
sees — verified stable across three consecutive runs.

Two defects found by measuring rather than looking:

- **63px of horizontal overflow at 375px.** Grid items default to
  `min-width: auto`, so a long route name pushed the whole row wider than the
  phone and the ellipsis that was meant to prevent it never engaged, because
  nothing constrained the width. Fixed with `minmax(0, 1fr)`.
- **A draft-persistence hazard.** `setPickup` and `setDestination` each persist
  the draft using the _other_ field as it was at render, so calling both in
  sequence would have stored the old pickup beside the new destination — a
  route nobody chose, waiting on the next reload. The example runner sets the
  draft once instead.

### Limitations

- The examples are US-only, because the tariff coverage is. In an uncovered
  country the first screen still leads with trips a visitor cannot use, though
  the coverage panel immediately below names what is actually covered.
- Coordinates are landmark centroids maintained by hand. The tests assert they
  still price, but nothing checks they are still the _best_ representative
  point for the landmark.

### Where the next cycle should look

1. **Comparing destinations.** JFK vs LGA vs EWR from one pickup would make the
   airport case decisive rather than merely priced, and the engine can already
   answer it.
2. **Share a scheduled trip.** The link machinery exists; carrying the
   departure would make "here is what our 6am cab costs" sendable.
3. **Localise the first screen.** Choosing examples near the visitor — from the
   covered set, without asking for location — would make the tour relevant
   rather than merely impressive.
4. **Metra's second dimension.** Its fare does not move on a clock but does
   move by zone; "walk two stops and save" is the flat-fare equivalent.

---

## Cycle 3 — Pricing a departure that has not happened yet

### Why this, and not the dead start

Last cycle's log put the empty state first. Reassessed against the product, it
was not the biggest lever. The airport run is the highest-stakes ride most
people take and the one they plan furthest ahead; it is exactly where a flat
fare plus a rush-hour surcharge produces surprises; and it was unanswerable,
because every price was for this minute and the day view stopped at +24h.

It is also the one question a product that refuses to forecast is _entitled_ to
answer. A tariff is a rule, not a market: "what will a cab to JFK cost at 6:20
on Tuesday morning?" is arithmetic on a rate card, with the same certainty as
pricing a trip leaving now. `computeFare` and `priceRailTrip` already took an
arbitrary instant. The work was giving them a different one, and then being
rigorous about everything the interface may no longer claim.

### What shipped

**A departure you can choose.** `QuoteRequest.departAt` threads through the
engine, the cache key and both tariff sources. A weekday 6:20am run to JFK
prices at $74.75; the same trip at 5pm is $79.75, because the $5.00 rush-hour
surcharge will be in force then.

**Three claims withdrawn**, each because it stops being true:

- `NormalizedQuote.scheduledFor` marks the quote a projection, so the card says
  **Scheduled fare** rather than "live" and the pulsing dot goes.
- `expiresAt` becomes null. A two-minute expiry greyed the card out and offered
  a Refresh that could only return the identical number.
- Auto-refresh disappears, for the same reason.

**Sources that cannot project decline.** A bike quote is only honest because it
names a station with a bike in it right now; nobody knows which docks will have
bikes on Tuesday. Bike share returns no quotes and the reason, without spending
an upstream call to find out.

**The timezone trap is closed.** `datetime-local` means the browser's wall
clock, which for the traveller booking a New York cab from London is not the
clock the surcharge windows are written against. Rather than guess, the result
states both when they differ: "Tue, Sep 8, 6:20 AM — 01:20 in New York City".

**The chart became a control.** Click or arrow to a time, and a `Leave 07:23`
button re-prices the whole comparison for it. The scrub pins on click, which
was not a nicety: `onPointerLeave` cleared it, so travelling to the button
destroyed the state the button acted on and it could never be clicked with a
mouse. Enter does the same from the keyboard.

**Discoverability.** The empty state now says what nobody would guess from a
search box — that the same tariffs price a departure 30 days out.

**Copy says which departure.** Found in the self-critique pass and the worst of
the lot, because it leaves the screen: a scheduled comparison pasted as
"Checked 9:41 PM · prices move, so this is a snapshot" reads in a chat as
tonight's price. It now names the departure and says the tariff does not
move — while still stating when the arithmetic was done, because a rate card
can be superseded even though the rule does not drift.

### Verified

- 565 unit and integration tests (from 548), including twelve new ones covering
  the surcharge that applies then rather than now, the withdrawn claims, the
  cache never crossing a scheduled answer with a live one, bike share's
  refusal, and the horizon rejecting the past, the far future and an
  offset-less timestamp, and the copied summary naming its departure.
- 103 fixture E2E; 25 credential-free E2E against a production build, three of
  them new: a scheduled fare costs more at rush hour than now, bike share drops
  out with its reason, and a time taken off the chart re-prices everything.
- In a real browser: the full loop by mouse _and_ by keyboard alone — tab to
  the chart, arrow to a time, Enter, and the comparison re-prices for it.
- Layout measured at 375px, 430px and 1180px: the two header chips and the
  heading share one 22px row with no overflow.
- A `setPointerCapture` throw found in the console and guarded; re-dispatching
  the same event now produces no error.

### Limitations

- The departure is not persisted with the route draft. Deliberate — finding
  yesterday's 6am flight still selected after a reload is a worse surprise than
  retyping — but it does mean a share link carries the route, not the time.
- The horizon is 30 days because a projection is only as good as the rate card
  behind it. Nothing yet _checks_ whether a card was re-verified since a
  projection was made.
- `datetime-local` is the browser's control. It is accessible and free of
  dependencies, but it cannot be styled to match the rest of the rail.

### Where the next cycle should look

1. **The dead start, finally.** Still nothing until two addresses are typed,
   and the empty state answers "why trust this?" before anyone has asked. It is
   now the clearest remaining gap.
2. **Comparing destinations.** JFK vs LGA vs EWR from one pickup is one query
   away and would make the airport case decisive rather than merely priced.
3. **Share a scheduled trip.** The link machinery exists; carrying the
   departure would make "here is what our 6am cab costs" sendable.
4. **Metra's second dimension.** Its fare does not move on a clock but does
   move by zone — "walk two stops and save" is the flat-fare equivalent.

---

## Cycle 2 — "When to go", and the bug it uncovered

### Why this, and not something else

The product's honesty machinery was already strong. Its _comparison_ was thin,
and getting thinner the better the honesty got: with the market-priced
providers gated behind agreements this deployment does not have, the flagship
trip — Manhattan to JFK — rendered as a single card labelled ONLY OPTION,
under five category filters (four of them empty) and three sort orders. The
chrome was sized for a comparison that was not happening, which made a
complete answer look like a failed one.

Meanwhile the one genuinely distinctive thing RideLens knows was buried three
scrolls inside a modal: **what this exact trip costs at every hour of the next
day**. Every fare here comes from a published rule on a clock — New York adds
$2.50 to a metered fare between 4pm and 8pm and $5.00 to the JFK flat fare;
Metro-North charges $13.75 for a peak seat and $10.25 for the same seat
off-peak — so the whole day is _computable_, with exactly the certainty this
minute is. Nothing else shows a rider that, because nothing else prices from
the tariff.

### What shipped

**A departure planner on the results page** (`src/ui/DeparturePlanner.tsx`,
`src/domain/departure.ts`). Every priceable option on one shared axis that
starts at NOW and runs 24 hours forward, each row a step chart of that option's
own fare, with a scrub line you can drag, arrow through, or tab to. Above it,
one sentence naming the most useful thing about timing this particular trip.

- The advice is ranked by what a rider can act on: a rise inside two hours
  first, then the biggest saving worth waiting for, then "you are already on
  the cheapest rate, and here is when that ends".
- That ranking is by **proportion**, not dollars — the first two-mode trip
  tested (Chelsea → Scarsdale) offers a $127 taxi that falls a dollar overnight
  and a $10.25 train that costs $3.50 more at peak. By the dollar the headline
  read "licensed taxi drops $1.00", which is true and worth nobody's attention.
  By proportion it is 0.8% against 34%.
- Each row is scaled to its own price range, because a $10 train and a $75 taxi
  share no useful scale, and prints its own floor and ceiling so the silhouette
  can never be read as a bigger swing than it is.
- Scrubbing shows the difference from now beside each price. Added in the
  self-critique pass, because the question the scrub is asking is "am I better
  off?" and answering it from the price alone means holding the original number
  in your head while you drag. The `aria-live` readout says the same thing in
  words.

**Rail got a fare clock at all.** Peak/off-peak was a $3.50 swing on Metro-North
— a quarter of the fare — and the app said nothing about it. `sampleFareDay`
is now generic over anything priced by a published rule, and
`railFareBoundaries` handles the part that is specific to a railroad: peak is
defined at the terminal, so an outbound fare changes at the window edge but an
inbound one changes when the rider _boards_, which is the run time earlier.

**A real bug, found by putting "now" next to the chart.** The day view sampled
"the next 03:30, the next 04:00, …" and laid the results on a
midnight-to-midnight axis — which splices two different days together, the
hours after now from today and the hours before it from tomorrow. Most of the
week that is invisible. The day this was built was Labor Day, and New York's
rush-hour surcharge is weekdays _excluding holidays_: the strip showed a 4pm
surcharge nobody would be charged, contradicting the quote beside it, with no
way to tell from the screen which was lying. Sampling now runs forward in
elapsed minutes, so every point is a real instant in the rider's future and the
day turns over where it should. Labels are read back off that instant, which
also makes them correct across a daylight-saving transition.

**Chrome that cannot do anything no longer appears.** The filter bar renders
only when there is more than one option or more than one category to filter to.

**"Pickup time unknown" is gone from tariff-priced cards.** It is an admission
of ignorance, and it should only be made where knowing was possible. A rate
card has no dispatch to ask.

### Verified

- 548 unit and integration tests (up from 528), including 20 new ones for the
  advice rules and a regression test that reconstructs the Labor Day splice.
- 103 fixture E2E, 22 credential-free E2E against a production build. Three are
  new: the chart must agree with the card, the timeline must price another
  departure by keyboard alone, and no taxi may be accused of failing to report a
  pickup time.
- Lint, types, Prettier clean.
- In a real browser, on a live NYC trip: the panel's "now" price matches the
  card; hover scrubbing moves a line across every row and updates both prices
  and the readout; arrow keys step 15 minutes, Shift 60, Home/End jump, Escape
  returns to now; the readout is `aria-live`.
- Layout measured, not eyeballed, at 375px and 1180px: no horizontal overflow,
  no clipped labels, no overlapping ruler ticks, and the three columns in
  register on desktop with the chart full-width on mobile.

Two layout bugs were caught this way and would not have been caught by eye:
`grid-row: 1 / -1` counts lines of the _explicit_ grid, so the scrub surface
had silently collapsed to a 43px strip over the first row; and sparse
auto-placement will not backtrack, so the desktop chart dropped to a second
line the moment the price column was placed before it.

### Limitations

- The planner covers tariff-priced modes only. Bike share has no time-varying
  fare to draw, and Uber/Lyft/Empower are market-priced — there is no honest
  forward view for either, and inventing one is the thing this product exists
  not to do.
- Metra publishes one fare all day, so a Chicago trip shows no panel. Correct,
  but it means the feature is invisible in one of the two rail markets.
- The scrub is a 24-hour window from now. It cannot answer "what about next
  Tuesday?", which is a real question for a booked flight.

### Where the next cycle should look

1. **The dead start.** The app still shows nothing until two addresses are
   typed. There is no way to explore what it knows, and the empty state answers
   "why trust this?" before anyone has asked. A one-tap way into a covered
   city, or honouring `Current location` more prominently, would let the
   product demonstrate itself.
2. **Scheduling beyond 24 hours.** "I fly Tuesday at 6am" is the highest-value
   unanswered question, and the tariff engine can already price it.
3. **Comparing destinations.** JFK vs LGA vs EWR from the same pickup is one
   query away and would make the airport case genuinely decisive.
4. **Metra's second dimension.** Its fare does not move on a clock, but it does
   move by zone — a "walk two stops and save" view would be the equivalent
   insight for a flat-fare railroad.
