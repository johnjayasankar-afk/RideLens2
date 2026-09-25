# Two proposals

Written 2026-09-25, after the audit, the provenance work, the coverage
honesty pass and the evaluation harness. Both take the same position: the
things this product was avoiding saying about itself turn out to point at
what it should be.

Each is a recommendation, not a survey.

---

# 1. Is a modeled estimate a viable product on its own?

**Yes — but not as a price. As an ordering.** And the product is currently
measuring the wrong thing to find out.

## The question as usually asked

"Can a model predict an Uber fare accurately enough to be worth showing?"

Asked that way the answer is discouraging, and the eval harness is built to
answer exactly it: coverage, bias, MAE, sharpness — all of them absolute. All
of them asking how close the number is to the fare.

Absolute accuracy is the hardest thing to get and quite possibly not the
thing that matters.

## The question worth asking

A rider standing on a pavement with four apps does not need to know that the
ride costs $27.40. They need to know **which app to open**, and roughly what
it will cost them to be wrong.

Those are different problems, and the second is dramatically easier, because
much of the model's error is _shared_ across providers. Distance, duration,
traffic, time of day and weather feed every provider's estimate through the
same engine. If the routing is long by 8%, every number is long by roughly
8%, and the ordering survives untouched.

What breaks an ordering is not error. It is **differential** error — the part
that hits one provider and not another:

- **Surge and Prime Time.** Provider-specific, idiosyncratic, and largest
  exactly when a rider cares most.
- **Regulatory fee stacks.** Modeled for New York and for no other market out
  of 49. A per-ride flat fee that applies to one provider's class of vehicle
  and not another's moves the ordering directly.
- **Promotions and subscriptions.** Uber One, Lyft Pink, ride credits. Not
  modeled, cannot be modeled without an account, and can invert a comparison
  on their own.
- **Rate-card staleness.** A tariff change we have not read is a bias on one
  provider until someone reads it.

That list is the actual risk register for this product, and none of it is
what `docs/CALIBRATION.md` currently measures.

## The recommendation

**Add an ordering metric, and make it the headline number.**

Concretely, in `src/lib/eval/metrics.ts`:

- **Ordering accuracy** — of comparisons where the model named a cheapest
  provider, how often was it actually cheapest.
- **Regret** — when the model was wrong, how much extra the rider paid by
  following it. A wrong ordering that costs 40¢ is not a product failure; one
  that costs $14 is.
- **Decisive-and-wrong rate** — how often the model asserted a clear winner
  (non-overlapping bands, so `comparePrices` returns `cheaper` rather than
  `similar`) and was wrong. This is the one that should gate a release. The
  product already refuses to assert a winner when bands overlap; this
  measures whether that refusal is calibrated.

The existing absolute metrics stay. They diagnose _why_ an ordering broke.
They just should not be the number anyone quotes.

## Why this also fixes the data problem

`docs/CALIBRATION.md` holds zero records, and the collection protocol asks a
person to open provider apps and transcribe exact fares for six routes at four
times of day. That is 48 rows a round and it is genuinely tedious, which is
why there are none.

**Ordering truth is far cheaper to collect than fare truth.** A rider who
reports only _which one they took and whether the other was cheaper_ has given
a scorable record. So has anyone who glances at two apps and notes the winner
without writing down either number. A screenshot of two open apps is a record.

That changes ground-truth collection from a transcription task into a
one-tap question, which is the difference between a corpus that exists and
one that does not.

## What would falsify this

If decisive-and-wrong rate comes in above roughly 10%, the product is
confidently sending people to the more expensive ride one time in ten, and
`comparePrices`' overlap threshold is miscalibrated rather than the model
being wrong. Fix the threshold first — widening bands until the product says
"similar price" more often is honest, and a comparison that frequently
declines to pick is still useful. A comparison that picks wrong is not.

If ordering accuracy is poor _even where bands are wide_, differential error
dominates, and no amount of hedging saves it. In that case the modeled
estimate is not a viable standalone product and the answer is partner feeds
or nothing.

## The position, stated plainly

A modeled estimate is viable as a **decision aid**, and is not viable as a
**price quote** — and this product has already, quietly, been built as the
first one. It refuses to show a midpoint. It declines to name a winner when
bands overlap. It labels every number's provenance. Every one of those
choices makes it a worse price quote and a better decision aid.

The proposal is to stop treating that as a limitation being apologised for
and start treating it as the product, including in what gets measured.

---

# 2. Where does this comparison belong?

**Attached to a trip somebody has already committed to — not behind a search
box.** The standalone destination is the weakest possible home for it, and
the model's supposed weakness is a decisive advantage in the right one.

## Why the standalone app is structurally hard

The stated job is "the thirty seconds before the decision." For a standalone
comparison site to win those thirty seconds, a rider has to:

1. Remember the product exists, at the moment of need,
2. Open it _instead of_ the app they were already reaching for,
3. Type or confirm two addresses,
4. Read the comparison,
5. Then open the ride app anyway, because RideLens does not book.

Step 5 is the problem. The product adds a step before a step, and pays for
itself only when the saving exceeds the friction. On a $27 ride where the gap
is $3, it does not, and the rider learns that and stops coming back.

This is not a marketing problem. It is the shape of the thing.

## Where trips are actually decided

A ride is rarely decided at the moment it is booked. It is decided earlier,
somewhere that already knows the origin, the destination and the time:

| Surface                        | Knows                          | Timing              |
| ------------------------------ | ------------------------------ | ------------------- |
| Calendar event with a location | Where, when, how long from now | Hours to days ahead |
| Flight or train confirmation   | Airport, arrival time          | Days ahead          |
| Hotel or venue booking         | Destination                    | Days ahead          |
| Maps, after a route search     | Origin, destination            | Seconds ahead       |
| Expense tool, after the fact   | What was paid                  | Too late to help    |

The first three are the interesting ones, and they share the property the
maps case does not: **they are in the future.**

## The argument that decides it

**A live quote API cannot price a trip that has not happened yet.**

Ask Uber what a ride to JFK costs at 6pm tomorrow and there is no answer,
because there is no marketplace state to quote against. The number does not
exist. That is not an API limitation; it is what an upfront quote _is_.

A model does not have this problem. A model built from published tariffs, a
routing engine, a time-of-day curve and a demand simulation can price 6pm
tomorrow exactly as easily as it prices now — with a wider band, honestly
labelled, which is the correct representation of a forecast.

So the modeled estimate's weakness against partner feeds — it is not a real
quote — **vanishes entirely in the future case, because there is no real
quote to lose to.** In that territory the model is not a cheap substitute for
partner data. It is the only thing that can answer the question at all.

Everything in this repository that looks defensive becomes an asset there. A
band rather than a point is what a forecast should look like. Confidence that
decays with age is what a forecast needs. `ESTIMATE_RANGE` was the right
primitive all along.

## The recommendation

**Reposition around the scheduled trip, and make the entry point a calendar
event or a travel confirmation rather than a search box.**

In order:

1. **Build forward-looking estimates properly.** The engine already takes a
   time; the product does not let anyone ask for one. Phase 8.2 of the brief
   is this, and it should be first rather than one item among six.
2. **Widen bands with horizon, and say so.** An estimate for tomorrow evening
   deserves a visibly wider band than one for now.
   `src/lib/domain/confidence.ts` already decays confidence with age; the
   same idea runs forwards, and the wording is the same.
3. **Take a trip as input, not two addresses.** A pasted flight
   confirmation, a calendar event, an `.ics` file. The addresses are in there
   already.
4. **Deliver where the decision happens**, not on a page someone must
   remember to visit — a calendar entry that carries the estimate, a
   notification the evening before with a refreshed number, a share-sheet
   action.
5. **Keep the live comparison** for the now case. It is the weaker product,
   but it is the one that proves the model against reality, and it is where
   ordering ground truth gets collected.

## What this costs

It gives up the fantasy of being the place people go to compare rides. That
fantasy is what most of this category dies of.

It also makes the accuracy question sharper rather than softer: a forecast
for tomorrow evening is checkable tomorrow evening, and a product that sends
a notification with a number has to stand behind it. Proposal 1's ordering
metric is the prerequisite — pointing at the future without measuring the
present would be the least honest thing this product has ever done.

## What already exists in this direction

`src/lib/embed.ts` allows this app to be framed by a specific origin, and it
was built so a portfolio page could show a live preview. It is not a
distribution channel and should not be mistaken for one. But it does
establish that the comparison renders correctly as a component inside someone
else's page, which is the technical precondition for everything above.

`MemoryTtlStore`, the session store and the deep-link state are likewise
already shaped for a comparison that can be handed to somebody rather than
only browsed.

## The position, stated plainly

The comparison does not belong on a website people visit. It belongs on a
trip they have already agreed to take, delivered before they think to ask —
and that is the one place where a modeled estimate beats a partner feed
rather than apologising to it.
