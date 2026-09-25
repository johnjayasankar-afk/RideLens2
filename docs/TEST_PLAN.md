# RideLens test plan

This file used to be RailDrop's — a train-booking product's plan, describing
watches, Thruway eligibility and rebooking, none of which exists here. It was
wrong in every line and had presumably been wrong since the repository was
started from that one.

What follows describes the suite that actually runs.

## What the tests are for

RideLens shows a number it computed itself and asks a rider to act on it. The
suite is therefore weighted toward **truthfulness** rather than toward
coverage of code paths: most of these tests fail when the product would say
something it cannot support, not when a function returns the wrong type.

The ones worth knowing about by name:

| Test                                               | Guards against                                       |
| -------------------------------------------------- | ---------------------------------------------------- |
| `cannot be improved by widening the band`          | A quality metric that rewards hedging                |
| `never raises confidence, at any age`              | Decay running backwards                              |
| `names a class without inventing a number`         | A percentage reappearing where nothing is calibrated |
| `shows a number somebody actually reported`        | The reconciler averaging two disagreeing sources     |
| `makes no network call while dormant`              | Reaching a partner endpoint before authorisation     |
| `turns no partner source on by itself`             | A default quietly flipping                           |
| `never lets an expired quote beat a live one`      | A ride option vanishing between reconcile and rank   |
| `refuses to imply a midpoint for a range`          | The single most common way this category misleads    |
| `never lets a public key read a personalised fare` | Cache bleed across account contexts                  |
| `refuses to report a statistic from too few rides` | Publishing a calibration from three samples          |

## Running it

```bash
npm run verify
```

Format, lint, typecheck, unit tests, build — in that order, stopping at the
first failure. End-to-end runs separately:

```bash
npx playwright test
```

## Unit — `tests/unit`

Vitest, no DOM, no network. 192 tests across 14 files.

**Honesty about provenance** — `provenance.test.ts`

What kind of number each source produces, and whether the decomposition adds
up. Every fee the engine emits must appear rather than being silently
dropped; the subtotal must not be listed twice; the rows must end on the
figure printed on the card, so a rider can reconcile them by eye.

**Confidence and its decay** — `confidence.test.ts`

The ladder, what age costs, and the distinction between a modeled guess and a
price a provider is holding. A held price does not decay; everything else
does, and can only ever move one way.

**Reconciliation** — `reconciler.test.ts`

Grouping the same product across sources, choosing between them, and naming
the disagreement when they differ materially — by $3 absolute or 15%
relative, whichever fires first. The section titled _the thing this must
never do_ asserts the visible row is one of the input objects by identity,
not a blend of them.

**The source contract** — `source-contract.test.ts`

Run against all five dormant adapters. See `docs/ENABLING_A_SOURCE.md`.

**Coverage and markets** — `market-coverage.test.ts`, `market-resolution.test.ts`, `market-fees.test.ts`

Three coverage states rather than two, so an unverified market stays hidden
instead of defaulting to available. A rate card is used only within its
calibrated radius, borrowed with a widened band out to the extrapolation
limit, and refused beyond it. Fee models exist for one market and the other
48 say so.

**Fares and the marketplace** — `rate-card.test.ts`

Known corridors with known answers: the Manhattan↔JFK flat fare, an 18-mile
off-peak run, a Westchester origin. Plus the marketplace simulation's own
properties — deterministic within a tick, different across ticks, and
diverging between providers at the same instant.

**The evaluation harness** — `eval-metrics.test.ts`, `actuals.test.ts`

The scoring arithmetic, the minimum-sample withholding, and the validation on
a rider-reported fare. Synthetic records here are fine and synthetic _ground
truth_ is not; the corpus loader enforces the difference by requiring an
origin on every record.

**Infrastructure** — `store.test.ts`, `session-store.test.ts`, `config-origin.test.ts`, `ratecard-freshness.test.ts`

TTL and LRU behaviour, cache key separation by account context, session
durability with and without Supabase, origin resolution across Vercel's
several host variables, and a test that fails the build before the committed
rate-card verification date ages out.

## End-to-end — `tests/e2e`

Playwright, Chromium desktop and mobile viewports, 22 tests.

Run against fixtures only:

```bash
RIDELENS_ALLOW_FIXTURES=true RATE_CARD_SOURCE_ENABLED=false npx playwright test
```

Fixtures are refused outright in a production build, so these cannot
accidentally run against real quotes.

Covered: the anonymous comparison flow, ranking the cheapest fixture first,
every quote carrying the semantics the UI depends on, deep-link restore of
route/mode/filter, a bare URL producing an empty form, the breakdown opening
and reconciling and closing on Escape, and `/sources` reporting honestly
without calling an unconfigured source.

Two conventions worth knowing before adding a test:

- **Use deep links, not the Compare button.** `Compare rides` matches the
  mobile sticky button as well as the form button, and strict mode fails.
- **The placeholders are `Search pickup address` and `Search destination`.**

## Not covered

Stated so nobody mistakes a green suite for a verified product:

- **No test of a live partner response.** All five adapters are dormant;
  their parsing paths are unexercised until credentials exist.
- **No accuracy testing.** `docs/CALIBRATION.md` holds zero records. The
  suite proves the model is _consistent_, never that it is _right_.
- **No visual regression.** Several defects in this codebase's history were
  caught by opening a browser and looking — a double-counted subtotal, a
  signal rendered as a 72% discount, `$NaN` on a total row. None would have
  been caught by any test here.
- **No load testing.** Rate-limit logic is unit-tested; behaviour under
  concurrency is not.
- **No axe or contrast automation.** Accessibility is checked by hand
  against `docs/A11Y.md`.

## When adding a test

Name it as a sentence about the product, not about the function. `never lets
an expired quote beat a live one` says what breaks if it fails; `test
reconcileQuotes sorting` does not, and the next person to see it red will not
know whether it matters.
