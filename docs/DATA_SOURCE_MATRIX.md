# Data source matrix

Verified: **2026-09-03**. Do not treat memory as authority — re-verify before enabling a source.

| Provider | Data source | Method | Live? | Price type | ETA? | Account personalized? | Comparison permitted? | Partner approval? | Booking | Current status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Uber | Obi FARE.AI | Licensed aggregation `POST /v1/quote` marketPrices | Yes (market percentiles) | ESTIMATE_RANGE (p25–p75) | No (FARE.AI) | No | Yes via Obi license | Yes — Obi | Deep link `m.uber.com/looking` | Adapter ready; needs OBI credentials |
| Uber | Uber Price Estimates API | Authorized direct | N/A | Range/estimate | Via time estimates | Possible with user OAuth | **No** under public API ToS § II B without written authorization | Required for comparison | Deep links allowed | **DISABLED** for comparison |
| Lyft | Obi FARE.AI | Licensed aggregation | Yes (percentiles) | ESTIMATE_RANGE | No | No | Yes via Obi | Yes — Obi | `lyft.com/ride` / `lyft://` | Via Obi when configured |
| Lyft | api.lyft.com `/v1/cost` + `/v1/eta` | Client credentials | If API still granted | ESTIMATE / RANGE | Yes | Public token = public pricing | Unclear commercially — gate with `LYFT_COMPARISON_AUTHORIZED` | Recommended | Deep link | Adapter ready; flag + secrets required |
| Empower | Obi (if included in market feed) | Licensed aggregation | When present in feed | ESTIMATE | Rarely | No | Via Obi | Yes — Obi | Interstitial → rideempower.com | Prefer Obi; direct stub pending |
| Empower | Direct partner API | Partner REST | If partner provides | ESTIMATE (never locked final unless proven) | If provided | Unknown | If contract allows | Yes | Interstitial unless official deep link verified | Stub ready |
| Curb | Obi | Licensed aggregation | When present | ESTIMATE_RANGE / varies | No | No | Via Obi | Yes — Obi | Interstitial → gocurb.com | Via Obi when configured |
| Curb | Curb Business / partner quote API | Partner REST | If granted | UPFRONT when API says so → TAXI | If provided | Business accounts possible | If contract allows | Yes — Curb Business | Interstitial (prefills not verified) | Adapter ready; needs CURB_API_* |
| Curb Flow | Supply-side demand network | Fleet API | N/A for consumer compare | N/A | N/A | N/A | Not a consumer multi-provider quote API | Partner | N/A | Not used as primary quote source |
| Waymo / others | Obi marketPrices keys | Licensed aggregation | When present | ESTIMATE_RANGE | No | No | Via Obi | Yes — Obi | Provider-specific later | Normalized when present |

## Obi FARE.AI notes

- Docs: https://docs.obifareai.com/
- Auth: `POST /v1/auth/token` with `X-API-KEY` (`pgw_…`) + `X-API-SECRET`
- Quote: `POST /v1/quote` → `marketPrices["UBER/Standard"] = {p5,p25,p50,p75,p95}`
- Semantics: fleet intelligent pricing / market distribution — **not** identical to in-app account-linked consumer upfront quotes
- Contact: lukasz@rideobi.com
- **Do not scrape** rideobi.com consumer app

## Location

| Provider | Status |
| --- | --- |
| Mapbox | Preferred when `LOCATION_PROVIDER=mapbox` + token |
| Google Places/Geocoding | When `LOCATION_PROVIDER=google` + key |
| Nominatim (OSM) | Default fallback with RideLens User-Agent; rate-limited; honest labeling |
