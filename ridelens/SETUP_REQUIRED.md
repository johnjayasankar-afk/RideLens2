# Setup Required

**Nothing here is required to run RideLens or to see live prices.** Out of the
box, with no keys and no contracts, it computes real regulated taxi fares from
published municipal rate cards in New York, Chicago, Washington DC and San
Francisco — exact for airport flat fares.

What follows unlocks **market pricing** (Uber, Lyft, Empower, Curb) and
production-grade infrastructure. Each item needs an account, an approval, a
contract or a credential — things code cannot do.

Each section gives the exact request to make, the exact fields to ask for, the
environment variable it maps to, and the command that verifies it.

---

## 1. Obi Intelligent Pricing — the primary source · **highest priority**

One agreement here turns on Uber, Lyft, Empower, Curb **and** Waymo at once. It
is also the only lawful route to Uber and Lyft coverage (see
`docs/DATA_SOURCE_MATRIX.md`).

**Contact:** Obi — `rideobi.com` → Contact.

**Say this:**

> We operate RideLens, a real-time consumer rideshare comparison application. We
> would like to licence the **Obi Intelligent Pricing API**.
>
> **Purpose:** real-time consumer rideshare price and ETA comparison, with
> booking handoff to the provider's own app. We do not resell the data.
>
> **Providers required:** Uber, Lyft, Empower, Curb. Waymo and other coverage
> welcome.
>
> **Data fields required per product:**
>
> - provider identifier
> - product identifier and display name
> - price — point amount, or low/high range
> - an indication of whether the price is upfront or an estimate
> - currency (ISO 4217)
> - pickup ETA (seconds)
> - trip duration and distance, where available
> - availability
> - quote timestamp and expiry, where available
> - booking URL or deep link, where available
>
> **Request shape:** pickup and dropoff latitude/longitude, one call per
> comparison.
>
> **Please confirm:** rate limits, per-call pricing, data freshness/TTL, cache
> retention permitted by contract, geographic coverage, whether account-linked
> personalised pricing is available, and any attribution requirements.

**Environment:**

```
OBI_API_KEY=...
OBI_API_BASE_URL=https://api.rideobi.com   # confirm the real base URL
```

**Verify:** `npm run verify:live`
**Capture the real schema:** `npm run verify:live -- --dump obi`

> **Schema note.** Obi does not publish its schema. `src/sources/obi/schema.ts`
> accepts several plausible shapes and is the **only** file that knows Obi's
> field names. If the real payload differs, edit that one file — nothing
> downstream changes. Also confirm the endpoint path; the adapter assumes
> `POST /v1/quotes` and `GET /v1/health`.

---

## 2. Curb Flow — direct taxi supply

The strongest **direct** (non-aggregated) source. Curb Flow already accepts ride
demand from third-party applications — Uber, Lyft and Ride Health are named
partners — so a comparison product fits its purpose rather than conflicting with
it. 100+ US cities.

**Contact:** Curb — `gocurb.com/curb-flow` → Contact Us.

**Say this:**

> We operate RideLens, a real-time consumer rideshare comparison application,
> and would like to integrate **Curb Flow** as a quote and booking source.
>
> **Purpose:** show live Curb taxi pricing and pickup ETAs alongside other
> providers, and hand riders into Curb to book.
>
> **We need:** a quote endpoint taking pickup/dropoff coordinates and returning
> service id and name, fare (upfront where the market supports it, otherwise a
> metered estimate or range), currency, pickup ETA, availability, quote expiry,
> wheelchair-accessible flag, and a booking URL or deep link.
>
> **Please confirm:** partner onboarding, sandbox credentials, rate limits,
> per-call pricing, market coverage, which markets return upfront versus metered
> pricing, and the correct deep-link format for handing a rider into Curb with
> the route prefilled.

**Environment:**

```
CURB_API_KEY=...
CURB_API_BASE_URL=https://api.gocurb.com   # confirm
```

**Verify:** `npm run verify:live`

> **Schema note.** The request/response shapes in `CurbFlowQuoteSource` are
> inferred. Confirm them at onboarding; the adapter assumes
> `POST /flow/v1/quotes`.

---

## 3. Geocoding — Google Maps Platform or Mapbox · **do this before real traffic**

RideLens ships with a working keyless geocoder (Nominatim + Photon), **verified
live**. It is permitted for low volume but capped near one request per second —
fine for development, not for consumer traffic. `startupChecks` warns
`KEYLESS_GEOCODER` on every boot until this is set.

**Google** (better venue and airport coverage): create a project, enable the
**Places API** and **Geocoding API**, create a key, restrict it by HTTP referrer
and API.

**Mapbox** (usually cheaper): create an account, take the default public token.

**Environment:**

```
LOCATION_PROVIDER_API_KEY=...
# For Mapbox, also set a pk.* token so auto-detection picks Mapbox:
NEXT_PUBLIC_MAP_KEY=pk....
```

**Verify:** `npm run verify:live` — section 1 prints the provider and timings.

---

## 4. Supabase — required for production

Production refuses to boot on in-memory storage (`NO_DURABLE_PERSISTENCE`).

1. Create a project at `supabase.com`.
2. Apply the migrations, in order:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   Or paste `supabase/migrations/0001_init.sql` then `0002_rls.sql` into the SQL
   editor.
3. Copy the URL, anon key and service-role key.

**Environment:**

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server only, never NEXT_PUBLIC
```

**Verify:** `curl localhost:3000/api/health` → `"persistence": "supabase"`.

---

## 5. Upstash Redis — required for production

Production refuses to boot on an in-memory limiter (`NO_DURABLE_RATE_LIMITER`),
which does not survive a restart or span instances.

Create a Redis database at `upstash.com` and copy the REST URL and token.

```
UPSTASH_REDIS_REST_URL=https://....upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

**Verify:** `/api/health` → `"rateLimiter": "upstash"`.

---

## 6. Booking deep-link attribution · _optional but recommended_

Without these, RideLens shows a generic handoff and tells the rider to enter the
route themselves — rather than emitting parameters the provider will ignore
while the UI claims a prefill that never happens.

- **Uber:** register an application on `developer.uber.com` for a `client_id`.
  This is for deep links, **not** the restricted quote API — but confirm with
  Uber that link attribution is acceptable for a comparison product. Set
  `UBER_DEEPLINK_CLIENT_ID`.
- **Lyft:** requires a Client ID from the Lyft Developer Program, which is the
  same closed programme. Set `LYFT_CLIENT_ID` if a partner agreement provides
  one.
- **Curb / Empower:** no documented deep-link format. Ask for one during partner
  onboarding.

**Then verify by hand** — this is the step no test can do. Install each provider
app, open a RideLens booking link on both iOS and Android, and confirm the
pickup and destination actually land. Only then change
`prefillVerification` to `'VERIFIED'` in that provider's builder. **Do not change
it on the strength of a well-formed URL.**

---

## 7. Uber direct quotes · _only with a written agreement_

**Do not set this without one.** Uber's API Terms of Use §II B prohibit using
the API in a product that compares Uber against competing services, and Uber's
price-estimate documentation states that offering such comparisons violates
those terms. Uber has enforced this by cutting off comparison apps.

If — and only if — you hold a written agreement granting comparison rights:

```
UBER_COMPARISON_RIGHTS_GRANTED=true
UBER_SERVER_TOKEN=...
```

Otherwise leave it `false`. Uber coverage comes from Obi.

---

## 8. Lyft direct quotes · _no route currently exists_

`developer.lyft.com` no longer accepts new applications and the official SDKs
are deprecated. There is nothing to apply for today.

If a partner agreement is ever granted, set `LYFT_CLIENT_ID`,
`LYFT_CLIENT_SECRET` and `LYFT_API_BASE_URL`; the adapter is written and tested
against the documented `/v1/cost` and `/v1/eta` contract.

**Do not** substitute a third-party vendor selling scraped Lyft pricing. That is
unauthorized access, and it is out of scope by policy.

---

## 9. Empower direct quotes · _no published programme_

Empower publishes no developer or partner API. If they open one, ask for the
same fields listed under Obi, and specifically ask:

> Does the rider-facing fare become binding at any point before a driver
> accepts? If so, which field indicates it?

The adapter emits `UPFRONT_QUOTE` only for an explicit `fare_is_guaranteed: true`,
and `ESTIMATE` otherwise.

```
EMPOWER_API_KEY=...
EMPOWER_API_BASE_URL=...
```

---

## 10. Deployment

No deployment platform is authenticated in this environment, so nothing was
deployed. To deploy to Vercel:

```bash
npm i -g vercel
vercel login
vercel link
vercel env add OBI_API_KEY production     # repeat per variable
vercel --prod
```

**After deploying, verify:**

```bash
curl https://<your-domain>/api/health
```

Confirm `liveDataAvailable`, `fixtureSourceActive: false`, and that `checks`
contains no `error` entries.

---

## Share links without Supabase

Share links work with no configuration at all, but the store is in-memory, so
links live only while the server process does. The UI says so inline when it
mints one. Configuring Supabase (§4) and applying
`supabase/migrations/0003_shared_routes.sql` makes them durable and adds the
30-day expiry sweep (`purge_expired_shared_routes()`, schedulable with pg_cron).

---

## Current state without any of this

RideLens runs and shows **live prices**. `/api/health` reports
`liveDataAvailable: true` with three live sources, none of which you have to
configure:

- `public_rate_card` — a real regulated taxi fare for New York, Chicago,
  Washington DC, San Francisco, Boston, Philadelphia and Seattle, computed from
  the published municipal tariff and a live route measurement. Airport flat
  fares are exact and binding. Elsewhere the source says which markets it covers
  rather than guessing.
- `regional_rail` — the commuter railroad's own published zone fare, which is
  the priced option for a trip starting outside any taxi jurisdiction. Covers
  Metro-North (New York, Connecticut) and Metra (Chicago).
- `bikeshare_gbfs` — a live shared-bike fare from the operator's open feed,
  naming a specific station and its bike count, refreshed every 60 seconds.
  Covers Citi Bike, Divvy, Bay Wheels, Capital Bikeshare and Bluebikes.

Every market-priced provider reports its blocker code, and the UI shows the
specific reason.

**No fixture data is ever substituted for a missing source** — not in the
product, not in the verification script.
