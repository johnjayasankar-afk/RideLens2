# Turning a source on

Five partner adapters ship dormant: Obi, Lyft, Curb, Empower, Uber. This is
what has to be true before any of them is switched on, and what to check
afterwards.

It is written as a runbook because the failure mode here is not a bug. It is
someone setting an environment variable on a Friday, the product quietly
beginning to call a partner's API, and nobody discovering the terms problem
until the partner does.

## Before anything technical

**Enabling a source is a commercial decision, not a configuration change.** The
adapters are gated on env vars because that is how software works, not because
the env var is the authorisation. Confirm, in writing, from the partner:

1. **That comparison is permitted.** This is the one that bites. Several
   providers grant API access for building _their_ booking flow and prohibit
   using the same data to display their prices next to a competitor's. Uber's
   API terms are explicit about it, which is why `UberAuthorizedQuoteSource`
   is scored at 40 in the reconciler and refuses by default with
   `COMPETITIVE_COMPARISON_RESTRICTED`.
2. **What the numbers mean.** An upfront quote, an estimate, and a metered
   projection are three different promises. Whichever it is has to map onto a
   `QuoteType` in `docs/QUOTE_SEMANTICS.md`, and if it maps onto none of them,
   stop and add one rather than picking the closest.
3. **Whether the quote is held, and for how long.** This becomes `expiresAt`,
   and `src/lib/domain/confidence.ts` treats a held price differently from a
   guess — it will not decay a number the provider is standing behind.
4. **Rate limits and caching rules.** Some agreements forbid caching quotes at
   all. `QUOTE_CACHE_TTL_SECONDS` is global; a stricter partner needs the
   adapter to opt out.
5. **Attribution and display requirements.** Logo, name, required disclaimers.

Record the answers in `docs/DATA_SOURCE_MATRIX.md` before writing code. If a
question has no answer yet, the source is not ready, whatever the credentials
situation is.

## The checks a machine already makes

`tests/unit/source-contract.test.ts` enforces the parts that can be enforced.
A new or woken adapter must pass all of them:

| Invariant                                    | Why it exists                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| No network call while dormant                | Reaching an endpoint before checking authorisation is a terms violation one deploy away |
| Fails as data, never as an exception         | One adapter throwing takes down the whole comparison                                    |
| Returns zero quotes when unconfigured        | A dormant source must not be the thing that invents a price                             |
| Never prints a credential                    | Error paths that interpolate a URL leak keys held in query strings                      |
| `capabilities()` claims nothing it cannot do | The admin panel is how an operator decides whether a source is working                  |
| No partner source enabled by default         | The standing rule of this repo, written where CI can check it                           |

That last one will fail the moment someone adds a source to
`discoverEnabledSources` without a gate. That is the intended behaviour, and
the fix is a gate, not an exception to the test.

## Wiring it up

### 1. Environment

Every partner needs credentials **and**, where comparison rights are the
question, an explicit authorisation flag. The flag is deliberately separate:
having a key is not the same as being allowed to use it this way.

| Source  | Credentials                                         | Authorisation flag                     |
| ------- | --------------------------------------------------- | -------------------------------------- |
| Obi     | `OBI_API_KEY`, `OBI_API_SECRET`, `OBI_API_BASE_URL` | none — licensed aggregator             |
| Lyft    | `LYFT_CLIENT_ID`, `LYFT_CLIENT_SECRET`              | `LYFT_COMPARISON_AUTHORIZED=true`      |
| Uber    | `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`              | `UBER_COMPARISON_AUTHORIZED=true`      |
| Curb    | `CURB_API_KEY`, `CURB_API_BASE_URL`                 | none — partner API is already scoped   |
| Empower | `EMPOWER_API_KEY`, `EMPOWER_API_BASE_URL`           | none — no public API exists; see below |

Empower has no public quote API. The adapter is shaped for a partner endpoint
that does not currently exist, and the realistic path to Empower prices is
through Obi. Setting `EMPOWER_API_BASE_URL` to something that merely responds
is not enabling Empower.

### 2. Coverage

`src/lib/domain/market-coverage.ts` decides where a provider is offered at
all, and it has three states rather than two: `OPERATES`,
`DOES_NOT_OPERATE`, `UNVERIFIED`. Only `OPERATES` surfaces.

Add the markets you have **checked**. Not the markets the partner's marketing
page lists, and not every market in the table because the API returned a
price there once. An unverified market stays `UNVERIFIED` and the provider
stays hidden, which is the correct outcome until someone does the checking.

Empower currently maps to `{}` — it surfaces nowhere, because nobody has
verified a single market for it.

### 3. Reconciliation

Add the source id to `SOURCE_QUALITY` in `src/lib/domain/reconciler.ts`. An
absent source falls through to the unknown-source score of 5, which is below
`fixture`. That has gone wrong once already.

Place it honestly relative to what is there: a real partner feed above
`public_rate_card` (20), a restricted one low like `uber_authorized` (40).

### 4. Semantics

Map the partner's response onto a `QuoteType`, and set `sourceMethod` and
`accountContext` to what is actually true. `ACCOUNT_LINKED` means the quote
was taken against this rider's own account and reflects their promotions; it
is not a synonym for "we used an API key".

## Turning it on

Enable in a preview deployment first, never straight to production.

```bash
# In the preview environment only.
LYFT_CLIENT_ID=... LYFT_CLIENT_SECRET=... LYFT_COMPARISON_AUTHORIZED=true
```

Then, in order:

1. **`/sources`** — the source should report healthy, and should name itself
   as live. If it says `misconfigured`, the credentials are wrong; if it says
   `disabled`, the authorisation flag is missing.
2. **`/api/admin/overview`** — `capabilities()` should now report
   `comparisonPermitted: true` and `supportsPrice: true`. If it does not, the
   adapter's gate disagrees with the registry's gate, and one of them is
   wrong.
3. **Run a real comparison** on a route in a market you marked `OPERATES`.
   Open the provenance sheet. The new source's quote must say where it came
   from and what kind of number it is.
4. **Check the reconciler** did something sensible where the new source and
   the rate card price the same product. Either it won and the modeled
   estimate stepped aside, or there is a discrepancy on the card naming the
   gap. Silence with two very different numbers means the grouping key did
   not match and the same ride is showing twice.
5. **Watch latency.** `QUOTE_REQUEST_TIMEOUT_MS` is 8s and the orchestrator
   runs sources concurrently, so a slow partner degrades rather than blocks —
   but a partner that times out on every request is a partner whose quotes
   nobody is seeing.

## After it is on

Enabling a real source changes what the eval harness is measuring. A corpus
collected against modeled estimates does not describe a product that now
shows partner quotes.

- Bump `MODEL_VERSION` in `src/lib/sources/ratecard/model-params.ts` if the
  change affects modeled numbers, so the corpus can be split at the boundary.
- Re-read `docs/CALIBRATION.md`. Per-provider slices for the new source will
  be withheld until there are 20 scorable records, which is correct and will
  look like a bug to someone who does not know.
- Update `docs/DATA_SOURCE_MATRIX.md` and the `/sources` copy so the public
  page stops describing the source as dormant.

## Turning it off again

Unset the credentials. That is the whole procedure, and it is deliberate: the
adapter's dormant path is a first-class code path with tests on it, not an
error state. A source that has been switched off must go back to returning a
typed failure and zero quotes, and `tests/unit/source-contract.test.ts` will
say so.
