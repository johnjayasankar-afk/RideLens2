# RideLens product spec

**Every ride. One comparison.**
What each way of making this trip costs, and how firm each number is.

---

## Who it is for

Someone standing on a pavement in New York with four apps on their phone, about
to open three of them to find out which is cheapest — and who will open the
winning one anyway to book, because RideLens does not book rides.

The job is the thirty seconds before that decision, not the ride itself.

## What a quote means here

This is the part most fare-comparison products get wrong, so it is stated
first.

A RideLens quote is **a number with a stated provenance and a stated firmness**.
It is never simply "the price". Four kinds exist, defined in
[`QUOTE_SEMANTICS.md`](./QUOTE_SEMANTICS.md):

| Type               | Means                                          | Shown as      |
| ------------------ | ---------------------------------------------- | ------------- |
| `UPFRONT_QUOTE`    | The source contractually asserts a locked fare | `$24.80`      |
| `ESTIMATE`         | Single expected fare that may move             | `Est. $24.80` |
| `ESTIMATE_RANGE`   | A band, from percentiles or a provider range   | `$27–34`      |
| `METERED_ESTIMATE` | A meter projection, not a locked price         | `Est. $27`    |

And a confidence class — `HIGH`, `MEDIUM`, `LOW`, `UNCERTAIN` — derived from the
type and the width of the band.

**A midpoint is never shown to a user.** `p50` exists to sort a list; it is not a
price anyone will pay, and printing it would invent precision the source never
offered.

## Today, in production: one source, and it is a model

As of this writing the only enabled quote source is `PublicRateCardQuoteSource`.
A quote is built from:

1. A live driving route from public OSRM — real distance, real duration
2. New York's **published** taxi and FHV rate cards, plus the NY regulatory fee
   stack by name (NYS surcharge, MTA congestion, Black Car Fund)
3. Tolls along the routed line
4. A **deterministic simulation** of marketplace behaviour
   (`marketplace-dynamics.ts`) — time-of-day and day-of-week demand curves, zone
   heat, provider personality, product elasticity, and minute-scale volatility
   on a fixed tick
5. A real precipitation signal from Open-Meteo

Items 1, 2, 3 and 5 are measurements. **Item 4 is a model.** It is calibrated
against published rate cards and public studies, it is deterministic given a
route and a clock, and it is not a live Uber price. No amount of it moving in
real time makes it one.

The product must never let a reader conclude otherwise. See "What RideLens will
never claim".

## The four providers and where they legally stand

Full detail in [`DATA_SOURCE_MATRIX.md`](./DATA_SOURCE_MATRIX.md); the summary
that matters for product decisions:

| Provider    | Comparison permitted?                                                                                                  | Status                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Uber**    | Via an Obi FARE.AI licence, yes. Via Uber's own public API, **no** — barred by ToS § II B absent written authorization | Adapter ready, gated on `OBI_*`                 |
| **Lyft**    | Via Obi, yes. Direct is commercially unclear                                                                           | Gated on `LYFT_COMPARISON_AUTHORIZED` + secrets |
| **Empower** | Via Obi where present in the feed; direct needs a partner contract                                                     | Stub ready                                      |
| **Curb**    | Via Obi, or a Curb Business partner API                                                                                | Adapter ready, gated on `CURB_API_*`            |

Every one of these is **off** right now, and the UI says so rather than quietly
showing a modeled number under a provider's logo.

Obi's consumer app is not to be scraped. The relationship is a licence or it
does not exist.

## The ranking contract under uncertainty

A comparison product's only real asset is that its comparisons are true.

- Two ranges that **do not overlap** may assert `cheaper` / `more_expensive`,
  and the claimed saving is the gap between the bounds — never between
  midpoints.
- Two ranges that **overlap by half or more** are `similar`. Not "probably
  cheaper". Similar.
- Partial overlap yields `unclear` with a hedged label ("Likely cheaper"), and
  only when the midpoint gap exceeds a floor.
- Two exact `HIGH`-confidence prices may be compared directly.

`comparePrices()` in `ranking.ts` is the single implementation. Exact $25 against
a $21–29 band must not report that the band is cheaper, because it might not be.

Expired quotes never rank.

## What RideLens will never claim

1. That a modeled number is a live provider quote.
2. That a range has a single price, by showing its midpoint.
3. That option A is cheaper than B when their bands overlap.
4. That a fare is final. The provider app is where a fare becomes real, and the
   interstitial says so.
5. That a provider is unavailable when the truth is that RideLens lacks a
   credential. "Not connected" and "no cars" are different sentences.
6. That a personalised, account-linked price applies to anyone else — those
   never enter the shared cache.

## Non-goals

- **No booking.** RideLens hands off to the provider; it never takes payment or
  dispatches a car.
- **No account linking** until a provider relationship makes it lawful and
  useful. Public pricing is the baseline.
- **No scraping** — not Obi's consumer app, not a provider's web funnel.
- **No fabricated midpoints**, and no interpolation presented as data.
- **Not a trip planner.** Turn-by-turn navigation and multi-leg itineraries are
  someone else's product.
- **Not a loyalty or rewards tracker.** Provider apps show credits and promos
  RideLens cannot see, and the UI discloses that rather than pretending
  completeness.

## What "done" looks like

A rider gets, within a few seconds of entering two addresses:

- Every way of making the trip that RideLens can price, ranked honestly
- For each: a price with its firmness, a pickup wait where one is known, and a
  one-tap route into the app that can actually book it
- A plain answer to "where did this number come from?" for any figure on screen
- No sentence anywhere that a careful reader could call a lie
