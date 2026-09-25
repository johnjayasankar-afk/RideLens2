# Quote Semantics

The normative definitions. If the UI, an adapter and this document ever
disagree, this document is wrong or the code is — resolve it here first.

RideLens's core promise is not "we found you the cheapest ride". It is **"here
is what each provider is telling us right now, and here is exactly how much that
number is worth"**. Every rule below exists to keep that promise.

---

## Three axes, on every quote, always

A quote is not a number. It is a number plus three facts about that number, and
they travel together from the adapter to the DOM.

### 1. `PriceType` — what kind of number is this?

| Value              | Meaning                                                                            | Emitted when                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `UPFRONT_QUOTE`    | The provider states a binding fare for this request and will honour it at booking. | The payload **explicitly** says so — an upfront fare field, an `is_upfront` flag, or a `type` containing `UPFRONT`. |
| `ESTIMATE`         | A single-point prediction. May move before or after the ride.                      | A point price with no upfront marker.                                                                               |
| `ESTIMATE_RANGE`   | A low/high band. **Both ends are real; the midpoint is not a price.**              | Distinct low and high values.                                                                                       |
| `METERED_ESTIMATE` | A meter decides the fare; this number models an outcome.                           | The payload marks the fare metered, or a taxi source gives a point price without an upfront marker.                 |
| `UNKNOWN`          | We cannot characterise it.                                                         | Fallback. **Never ranked as cheapest, never rendered as a price.**                                                  |

**The one-way rule.** A price type may be _narrowed_ by evidence but never
_widened_ by optimism. There is no code path that turns an `ESTIMATE` into an
`UPFRONT_QUOTE` because it looked precise, and none that treats a `low === high`
range as a guaranteed fare. `low_estimate === high_estimate` from Uber is an
`ESTIMATE`, not an upfront quote — Uber committed to nothing.

### 2. `Freshness` — how old is it, right now?

Computed from wall-clock age **at read time**, never stored as a fixed label. A
quote that was `LIVE` when fetched becomes `STALE` while it sits on screen, and
the card says so — `useCompareSession` ticks once a second for exactly this.

| Value     | Age                                    | Behaviour                                             |
| --------- | -------------------------------------- | ----------------------------------------------------- |
| `LIVE`    | ≤ 20 s                                 | Shown as "Live estimate" / "Live quote"               |
| `RECENT`  | ≤ 60 s                                 | Shown with its age: "45 sec ago"                      |
| `STALE`   | ≤ 180 s                                | Age shown in a warning tone                           |
| `EXPIRED` | > 180 s, **or past a provider expiry** | **Never presented as a current price.** Not bookable. |

A provider-declared `expiresAt` is authoritative and overrides the age
heuristic entirely: a five-second-old quote whose stated expiry has passed is
`EXPIRED`. An unparseable timestamp is treated as `EXPIRED`, never as fresh —
the failure mode has to be conservative.

### 3. `AccountContext` — whose price is it?

| Value            | Meaning                                                     |
| ---------------- | ----------------------------------------------------------- |
| `PUBLIC`         | Anonymous market price. No rider identity applied.          |
| `ACCOUNT_LINKED` | Produced against this user's linked provider account.       |
| `UNKNOWN`        | The source did not say. Keyed as `PUBLIC` for cache safety. |

This axis is a **security control**, not a label. `ACCOUNT_LINKED` results are
never written to the shared cache, and the cache key carries the account scope
so one rider's personalised price can never be served to another. Pinned by
tests in `tests/unit/security.test.ts` and `tests/integration/engine.test.ts`.

---

## What "live" means

RideLens calls a comparison **live** only when a real external request was made
to an authorized source during that session and returned within the freshness
window. Specifically:

- A cache hit within the source's TTL is live — it is a real response, recently.
- A fixture is **never** live. `demo_fixture` quotes are labelled "Fixture data",
  ranked below every real source, and cannot exist in a production build.
- A deployment with no live source configured says so in the UI and at
  `/api/health` (`liveDataAvailable: false`) rather than rendering empty cards.

`enabledLiveSources()` — enabled **and** not `LOCAL_FIXTURE` — is the single
definition used by the health endpoint, the startup checks and the home page.

---

## No false precision

The rule that most shapes the UI:

| Source says        | RideLens shows          | RideLens never shows  |
| ------------------ | ----------------------- | --------------------- |
| `$27–34`           | **$27–34** · Est. range | ~~$30.50~~            |
| `estimated $24.80` | **$24.80** · Est.       | ~~$24.80 guaranteed~~ |
| upfront `$28.40`   | **$28.40** · Upfront    | —                     |
| `"Metered"`        | _(product dropped)_     | ~~$0.00~~             |

`rankingPriceMinor` holds the midpoint of a range **for sorting only**. It is
never rendered, never spoken to a screen reader, and never used in savings copy
except through the uncertainty comparator. `formatRange` renders `$27–34` rather
than `$27.00–34.00` when both ends are whole, because trailing zeros imply a
precision the estimate does not have.

---

## Ranking under uncertainty

**The failure this prevents:** an exact $25.00 upfront fare and a $20–40
estimate. Sorting by the low end says "$20 is cheaper". That is a claim the data
does not support — $20 is a marketing floor, the band's own midpoint is $30, and
the $25 is the only number anyone has committed to.

RideLens compares **intervals**, not points. A point price is a zero-width
interval, so "does $25 fall inside $20–40?" is answerable.

```
overlap = intersection(a, b) / width(narrower interval)
```

| Condition                                                    | Verdict            | UI                |
| ------------------------------------------------------------ | ------------------ | ----------------- |
| centre gap ≤ $1.00                                           | `SIMILAR`          | "Similar price"   |
| overlap ≥ 0.60                                               | `SIMILAR`          | "Similar price"   |
| overlap ≤ 0.15 **and** neither side is `LOW`/`INDETERMINATE` | `A_CHEAPER`        | "Best price"      |
| otherwise                                                    | `A_LIKELY_CHEAPER` | "Likely cheapest" |

So for the headline case: overlap is 1.0 (total containment) → `SIMILAR` →
"Similar price". RideLens declines to rank them. `tests/unit/uncertainty.test.ts`
asserts the verdict is _not_ `A_CHEAPER`, alongside the non-overlap, small-overlap
and large-overlap cases.

### Confidence

| `PriceType`                               | Confidence                                         |
| ----------------------------------------- | -------------------------------------------------- |
| `UPFRONT_QUOTE`                           | `HIGH`                                             |
| `ESTIMATE`                                | `MEDIUM`                                           |
| `ESTIMATE_RANGE`, width ≤ 15% of midpoint | `MEDIUM`                                           |
| `ESTIMATE_RANGE`, wider                   | `LOW`                                              |
| `METERED_ESTIMATE`                        | `LOW` — traffic decides, and we cannot see traffic |
| `UNKNOWN`                                 | `INDETERMINATE`                                    |

Confidence is the **secondary** sort key. Where two options are statistically
indistinguishable, the firmer promise wins — a $28.40 upfront taxi ranks above a
$24–32 estimate, because the rider can actually rely on it.

Cross-currency quotes are never numerically compared; they order by currency
code, and no savings line is generated across currencies.

---

## Savings

Always integer minor units, always against a baseline the rider could actually
book.

- Baseline: an explicit choice, else the most recognisable comparable provider
  present (Uber, then Lyft), else the next-cheapest bookable option in the same
  category and currency.
- `Save $9.12 vs UberX` — only when the comparator returns a definite verdict.
- `Likely saves about $7.00 vs UberX` — when the claim rests on a wide range.
- `Similar price to UberX` — when they are indistinguishable.
- `+$9.12 vs Everyday` — a premium is stated plainly, never hidden.
- Nothing at all — when there is no honest comparison to make.

Unavailable and expired options are never used as a baseline, because a saving
against something you cannot book is not a saving.

---

## Provider-specific semantics

**Uber.** The estimates endpoint returns a range, not the upfront fare the Uber
app shows. RideLens labels it `ESTIMATE_RANGE`. Distances arrive in **miles** and
are converted to metres at the adapter boundary.

**Lyft.** Money arrives **already in minor units** (`estimated_cost_cents_min`).
Those values bypass `majorToMinor` entirely — passing them through it would
multiply every Lyft fare by 100. A test pins this.

**Empower.** Driver-priced. The pre-assignment number is a prediction of what a
driver will charge, so `ESTIMATE` is hard-coded. `UPFRONT_QUOTE` requires an
explicit `fare_is_guaranteed: true`.

**Curb.** Upfront in some markets, metered in others; the payload decides.
Category is `TAXI`, never `STANDARD` — but taxi _is_ included in the **Best**
view, because riders care about price across those categories.

---

## Regulated fares

A licensed taxi's fare is not a market price. It is set by a public authority
and published, which makes it computable rather than quotable — and puts it in
a different truth category from everything else on the screen.

**Airport flat fares are `UPFRONT_QUOTE` with `HIGH` confidence.** JFK ↔
Manhattan is $70 by rule. That is not RideLens's estimate of a price; it is the
price, and it does not move with distance, traffic or time in the vehicle. The
band collapses to a point because there is nothing to be uncertain about.

**Metered fares are `METERED_ESTIMATE` with a band.** The meter charges by
distance above a speed threshold and by time below it. We can measure the route
but not the traffic, so the band runs from _no slow time at all_ to _every
second the route takes beyond free-flow charged as slow time_. That is stated
on the quote in words, not implied by a range.

**What a regulated fare is not.** It is never presented as, substituted for, or
averaged with Uber, Lyft or Empower pricing. Those are market-set and move
minute to minute; a rate card for them would be an invention. The taxi is a
different option standing next to them, and the card says `Licensed taxi`.

**What it excludes.** Tolls and gratuity, always, and the quote says so. Both
are added at the end of a real trip and neither is knowable from a rate card.

**Availability is `UNKNOWN`, not `AVAILABLE`.** A rate card knows the fare
exactly and nothing about where the cabs are. `UNKNOWN` means the source did
not say — which is why `isBookable` treats only an explicit `UNAVAILABLE` as a
negative. Burying a real fare because nobody claimed a cab was nearby would be
the wrong reading of silence.

**Pickup ETA is `null`.** Not zero, not a guess.

## Tolls

The meter is the meter, and tolls are added on top — New York says so
explicitly: _"discounted E-ZPass tolls will be added to the passenger fare at
the end of the trip"_. Leaving them out is not neutral. JFK to Manhattan is
$74.75 on the meter and roughly seven dollars more if the driver takes the
Queens-Midtown Tunnel, so a tenth of the fare was simply missing.

Two rules keep this honest:

- A toll is claimed only when the **routed polyline actually passes through**
  the crossing. Never inferred from where the trip starts and ends.
- A toll goes to the **top of the band and never the floor**, marked uncertain.
  The driver picks the road and most of these crossings have a free alternative
  a few blocks away — the Queensboro Bridge is free, the tunnel is not. "Between
  X and Y, depending on the way they go" is the true answer.

Missing a toll is the failure mode we accept, because it only ever leaves the
quote where it already was.

## Party size

Chicago, Washington, Philadelphia and Seattle each publish a per-passenger
charge, so
the number of riders is part of the price rather than only a filter on what
fits. It is part of the cache key too: a party of four must never be served a
fare that was quoted for one.

Where the charge starts differs and matters: Chicago, DC and Philadelphia charge
from the **second** passenger, King County "per passenger over two persons" —
so two people ride Seattle for the base fare. Modelling that as "from the
second" would be a silent overcharge on every couple travelling together.

Everywhere else party size stays inert, and a test asserts that.

## When a fare changes

RideLens makes exactly one forward-looking claim, and only for regulated taxi
fares: _"this fare rises $2.50 at 16:00"_ or _"$1.50 less from 20:00"_.

That is allowed because a municipal tariff is a **published rule with fixed
switchover times**, so pricing the same measured route at a later clock carries
exactly the same certainty as pricing it now. It is arithmetic on a rate card,
not a forecast of demand.

- The projection is `computeFare` run again at the later instant. A test asserts
  the number shown equals pricing that instant directly — the outlook cannot
  drift from the engine.
- A rise is reported only within 90 minutes, a saving only within 4 hours.
  "Cheaper after 20:00" told at 09:00 is trivia, not help.
- A rise takes precedence over a saving, because it is the one with a deadline.
- If nothing changes inside those windows, nothing is shown. There is no
  "prices are stable" reassurance, because that would be a claim about the
  future the tariff does not make.

Because the rule is knowable at every hour, not just the next one, the detail
sheet also draws **the whole day**: each distinct price band across 24 hours,
the cheapest marked, and a mark for now. Consecutive samples at the same price
collapse into one band, which is why a card with two surcharges produces three
rows rather than forty-eight — and a test asserts those bands tile the day
exactly, and that the band containing "now" holds the price on the card. If the
strip and the headline could disagree, one of them would be lying and the screen
would not say which.

A fare that never moves draws nothing at all. A flat line would imply a
variation that is not there.

**There is no equivalent for market-priced providers, and none is invented.**
Uber and Lyft publish no rule that could be evaluated forward, so a surge
prediction would be a guess wearing the same typography as a fact.

## Shared bikes

A bike quote exists only if a real trip does. The source refuses to price one
unless it can name a station with a bike in it right now and another with a free
dock, both within a short walk. "This city has bike-share" is not a price.

- **Price** is `ESTIMATE_RANGE`. The unlock fee and per-minute rate are
  published figures; what varies is how long the ride takes, so the band comes
  from ride duration and nothing else.
- **Pickup ETA** is a real walk to a specific named station, not a guess.
- **Availability** is `AVAILABLE` only while that station actually holds a bike.
- **Freshness** carries the operator's own `last_updated` and TTL, typically 60
  seconds — the shortest-lived quote in the product, and honestly so.
- **Category** is `BIKE`, and the UI keeps it out of the vehicle ranking. A bike
  is almost always cheapest; letting it win "cheapest ride" would quietly turn a
  ride comparison into a mode comparison.
- **Booking** is `INFO_ONLY`: unlocking happens at the dock in the operator's
  app, so no link is offered rather than a fabricated one.

## Priceable, but nowhere to send you

Some options can be priced accurately and still have no destination to navigate
to — a street-hailed taxi, a docked bike. Those carry `INFO_ONLY` with a null
URL, the card reads "How to ride" rather than "Book", and the sheet explains
what to do. Inventing a plausible-looking link would be worse than admitting
there isn't one.

## Promotions

RideLens sees market prices, not the rider's account. Provider credits, promo
codes and loyalty pricing can all change the final number. The booking
interstitial states this every time:

> _[Provider] confirms the final fare in its own app. Your account there may
> also show promotions or credits that RideLens cannot see._

We never estimate a promotional discount, and we never claim a saving that
depends on one.

---

## Money

Every price is an **integer count of minor units** — cents, pence, whole yen.
No float ever holds a price.

`23.84 * 100 === 2383.9999999999995` in IEEE-754. `majorToMinor` parses the
decimal _representation_ rather than multiplying the float, and handles
currencies whose minor unit is not 10⁻² (JPY: 0, KWD: 3). It throws on
unparseable input — `"Metered"` drops the product rather than becoming `0`.

An ESLint rule bans `Math.round` outside the modules that do integer-only
arithmetic, so a currency float cannot be rounded into the codebase by accident.
