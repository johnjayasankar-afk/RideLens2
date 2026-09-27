# Data source matrix

Verified: **2026-09-03**. Do not treat memory as authority — re-verify before enabling a source.

| Provider       | Data source                         | Method                                             | Live?                    | Price type                                  | ETA?               | Account personalized?         | Comparison permitted?                                            | Partner approval?       | Booking                                         | Current status                         |
| -------------- | ----------------------------------- | -------------------------------------------------- | ------------------------ | ------------------------------------------- | ------------------ | ----------------------------- | ---------------------------------------------------------------- | ----------------------- | ----------------------------------------------- | -------------------------------------- |
| Uber           | Obi FARE.AI                         | Licensed aggregation `POST /v1/quote` marketPrices | Yes (market percentiles) | ESTIMATE_RANGE (p25–p75)                    | No (FARE.AI)       | No                            | Yes via Obi license                                              | Yes — Obi               | Deep link `m.uber.com/looking`                  | Adapter ready; needs OBI credentials   |
| Uber           | Uber Price Estimates API            | Authorized direct                                  | N/A                      | Range/estimate                              | Via time estimates | Possible with user OAuth      | **No** under public API ToS § II B without written authorization | Required for comparison | Deep links allowed                              | **DISABLED** for comparison            |
| Lyft           | Obi FARE.AI                         | Licensed aggregation                               | Yes (percentiles)        | ESTIMATE_RANGE                              | No                 | No                            | Yes via Obi                                                      | Yes — Obi               | `lyft.com/ride` / `lyft://`                     | Via Obi when configured                |
| Lyft           | api.lyft.com `/v1/cost` + `/v1/eta` | Client credentials                                 | If API still granted     | ESTIMATE / RANGE                            | Yes                | Public token = public pricing | Unclear commercially — gate with `LYFT_COMPARISON_AUTHORIZED`    | Recommended             | Deep link                                       | Adapter ready; flag + secrets required |
| Empower        | Obi (if included in market feed)    | Licensed aggregation                               | When present in feed     | ESTIMATE                                    | Rarely             | No                            | Via Obi                                                          | Yes — Obi               | Interstitial → rideempower.com                  | Prefer Obi; direct stub pending        |
| Empower        | Direct partner API                  | Partner REST                                       | If partner provides      | ESTIMATE (never locked final unless proven) | If provided        | Unknown                       | If contract allows                                               | Yes                     | Interstitial unless official deep link verified | Stub ready                             |
| Curb           | Obi                                 | Licensed aggregation                               | When present             | ESTIMATE_RANGE / varies                     | No                 | No                            | Via Obi                                                          | Yes — Obi               | Interstitial → gocurb.com                       | Via Obi when configured                |
| Curb           | Curb Business / partner quote API   | Partner REST                                       | If granted               | UPFRONT when API says so → TAXI             | If provided        | Business accounts possible    | If contract allows                                               | Yes — Curb Business     | Interstitial (prefills not verified)            | Adapter ready; needs CURB_API_*        |
| Curb Flow      | Supply-side demand network          | Fleet API                                          | N/A for consumer compare | N/A                                         | N/A                | N/A                           | Not a consumer multi-provider quote API                          | Partner                 | N/A                                             | Not used as primary quote source       |
| Waymo / others | Obi marketPrices keys               | Licensed aggregation                               | When present             | ESTIMATE_RANGE                              | No                 | No                            | Via Obi                                                          | Yes — Obi               | Provider-specific later                         | Normalized when present                |

## Obi FARE.AI notes

- Docs: https://docs.obifareai.com/
- Auth: `POST /v1/auth/token` with `X-API-KEY` (`pgw_…`) + `X-API-SECRET`
- Quote: `POST /v1/quote` → `marketPrices["UBER/Standard"] = {p5,p25,p50,p75,p95}`
- Semantics: fleet intelligent pricing / market distribution — **not** identical to in-app account-linked consumer upfront quotes
- Contact: lukasz@rideobi.com
- **Do not scrape** rideobi.com consumer app

## Location

| Provider                | Status                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| Mapbox                  | Preferred when `LOCATION_PROVIDER=mapbox` + token                        |
| Google Places/Geocoding | When `LOCATION_PROVIDER=google` + key                                    |
| Nominatim (OSM)         | Default fallback with RideLens User-Agent; rate-limited; honest labeling |

## An unverified citation: "RideWise"

`src/lib/sources/ratecard/` cites **RideWise** fourteen times as the authority
behind fare anchors, a NYC surge table, airport corridor midpoints and the
late-night wait trough. Nothing in this repository says what it is — no URL,
no document, no date beyond a year. It was also named in the methodology
string shown to riders, alongside TLC, which _is_ a real and checkable
publisher.

The numbers have not been changed. They are the right order of magnitude and
something has to be shown. What changed is the claim made about them:

- The rider-facing string no longer names it. Telling someone a number came
  from a source they cannot look up is the same failure as showing a modeled
  price as a quote, and this product does not get to do one while refusing
  the other.
- The wait parameters moved to `MODEL_PARAMS.wait`, recorded as priors fitted
  to nothing, and `npm run eval` can now score them.
- The remaining in-code citations are marked unverified rather than deleted,
  because deleting them would erase the record of where someone believed the
  figures came from.

**If RideWise is a real source**, add it here with a link and a date and the
citations can stand. **If it is not**, the anchors need re-deriving from the
published cards, and `docs/CALIBRATION.md` is the thing that would catch how
wrong they are.

The Empower "~30% under Uber/Lyft" figure, attributed to "Obi Q1 2026", has
the same problem and is now described to riders as an unverified estimate.

## Pricing structure, per operator

Read 2026-09-27. These are structural facts about how each operator prices —
not rate values, which remain unverified per `freshness.ts`. Each is quoted
from the operator or the regulator rather than from a rideshare blog, which
is the distinction `model-params.ts` draws when it records "RideWise"
appearing fourteen times as an authority checkable nowhere.

| Claim                                                                                                                                               | Source                                                                                                               | What it changed                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Surge is "a multiplier to standard rates, an additional surge amount, or an upfront fare including the surge amount… varies depending on your city" | [Uber, How surge works](https://www.uber.com/us/en/drive/driver-app/how-surge-works/)                                | Surge applies to the rate-driven fare        |
| "Uber's service fee percentage does not change during surge pricing"                                                                                | [Uber, How surge works](https://www.uber.com/us/en/drive/driver-app/how-surge-works/)                                | Flat fees are not surged                     |
| "Service fee: Flat amount that varies by region"                                                                                                    | [Lyft, How fares are calculated](https://help.lyft.com/hc/en-us/articles/115012925707-How-Lyft-fares-are-calculated) | Lyft's service fee is flat, so not surged    |
| Lyft base rate is set by "route, ride type, driver availability, and demand"                                                                        | [Lyft, How fares are calculated](https://help.lyft.com/hc/en-us/articles/115012925707-How-Lyft-fares-are-calculated) | Base fare stays inside the multiplier        |
| Drivers "Set Your Own Rates" or use "suggested rate card(s)"; no surge or demand mechanism documented                                               | [Empower, Drivers](https://driveempower.com/drivers/)                                                                | Empower no longer modelled as surging        |
| HVFHS driver minimum $1.283/mile and $0.681/minute, effective 2026-03-01                                                                            | [NYC TLC, Driver pay rates](https://www.nyc.gov/site/tlc/about/driver-pay-rates.page)                                | Now a floor under Uber and Lyft fares in NYC |

### Empower and the TLC

The NYC TLC stated on 2026-02-13 that Empower is not licensed in New York
City, that "every ride is illegal", and that in a crash "both the rider and
the driver might not get insurance covering that ride because it's not
registered" ([FOX 5 New York](https://www.fox5ny.com/news/empower-uber-lyft-drivers-nyc-tlc)).
Empower's own site continues to list New York as a market.

This was raised and the decision was to leave RideLens's presentation of
Empower in NYC unchanged — it is quoted like any other option, with no
regulatory note. Recorded here because the `ProviderUnavailable` mechanism
exists and was deliberately not used.

### The one place a rate value could be corrected

`city-rates.json` is unverified — `freshness.ts` says so for the whole table
— so its values are left alone rather than swapped for a better guess. The
exception is the New York per-minute rate, and it took a regulator to make
the case.

The card charges a _passenger_ $0.35 a minute. New York requires the
operator to pay the *driver* $0.681 a minute. On a ten-mile, forty-five
minute crawl the card produces $35.80 of rate-driven fare against a $43.48
driver minimum — the passenger paying less than the driver must receive,
before the platform takes anything at all.

That does not establish what the right per-minute rate is, so the card is
untouched. It does establish a floor, because a platform takes a commission
rather than paying a subsidy. `tlcDriverMinimumDollars` is applied as one:
before surge, since it bounds the trip rather than the demand on it, and
only for Uber and Lyft in NYC — the metered taxi is priced under a different
tariff, and Empower is not licensed as an HVFHS base.

It moved 48 of 125 canonical fares, all upward, by 1.5% to 16.4%. Lyft moved
further than Uber because its card's per-minute rate is a cent lower, so the
floor bites harder.
