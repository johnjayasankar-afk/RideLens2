# Quote semantics

## Live

A quote is **LIVE** when received within the last 30 seconds and not past `expiresAt`.

- **RECENT**: 30s–120s
- **STALE**: 120s–300s
- **EXPIRED**: older than stale threshold or past provider/session expiry

Expired quotes are never ranked as current.

## Upfront

`UPFRONT_QUOTE`: source contractually represents a locked or provider-guaranteed fare before request (e.g., Curb upfront when partner API asserts `upfront: true`). Display exact amount without `Est.`

## Estimate

`ESTIMATE`: single-point expected fare that may change (Empower pre-assignment, many public APIs). Display as `Est. $24.80`.

## Estimate range

`ESTIMATE_RANGE`: low–high bound (Uber-style ranges, Obi percentiles). Display `$27–34`. **Never** show a fabricated midpoint to users. Midpoint/`p50` is ranking-only.

## Metered

`METERED_ESTIMATE`: taxi-style meter projection when source says metered.

## Confidence

| Type | Confidence |
| --- | --- |
| Exact UPFRONT | HIGH |
| Single ESTIMATE | MEDIUM |
| Narrow range (≤15% width) | MEDIUM |
| Wider range | LOW / UNCERTAIN |

## Ranking under uncertainty

If ranges overlap significantly, relation is `similar` or `unclear` (“Likely cheaper”), never a false precise “$X cheaper” claim from a midpoint alone.

Non-overlapping ranges may assert cheaper/more expensive using the gap between bounds.

## Personalized pricing

`ACCOUNT_LINKED` quotes must not enter the public shared cache. UI discloses that provider apps may show promotions/credits not reflected in RideLens.

## Obi-specific

Obi FARE.AI `marketPrices` → always `ESTIMATE_RANGE` with display band p25–p75 (fallback p5–p95 / p50), ranking on p50. Metadata records that these are market percentiles, not consumer app screenshots.
