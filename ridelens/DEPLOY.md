# Deploying RideLens

## The short version

```bash
git init && git add -A && git commit -m "RideLens"
gh repo create ridelens --private --source=. --push
```

Then on [vercel.com/new](https://vercel.com/new), import the repository and
press Deploy. **No environment variables are required.** Vercel detects Next.js,
runs `npm run build`, and the deployment serves live prices immediately.

That is not a figure of speech: a production build with an empty environment was
verified to return a real JFK ↔ Manhattan flat fare and live Citi Bike prices.

---

## What works with nothing configured

|                       | Works   | Why                                                                       |
| --------------------- | ------- | ------------------------------------------------------------------------- |
| Regulated taxi fares  | **Yes** | Municipal rate cards are published documents. Seven markets.              |
| Commuter-rail fares   | **Yes** | Published zone tables. Metro-North (New York) and Metra (Chicago).        |
| Shared-bike prices    | **Yes** | GBFS is an open standard published for trip planners.                     |
| Address search        | **Yes** | Keyless OpenStreetMap geocoding.                                          |
| Route + map           | **Yes** | Public OSRM routing, OpenStreetMap tiles.                                 |
| Uber / Lyft / Empower | No      | Needs an authorized data agreement. Shown as unavailable with the reason. |

`/api/health` will report **`degraded`** with two errors. That is correct and
deliberate — read on.

## What the health check will tell you, and why it is right

```
[error] NO_DURABLE_PERSISTENCE
[error] NO_DURABLE_RATE_LIMITER
[warn ] KEYLESS_GEOCODER
```

These are honest warnings about a serverless deployment, not bugs:

- **Persistence is in memory.** Share links are written on whichever instance
  handled the request and read from whichever handles the next one, so a share
  link will often 404. Everything else is unaffected — prices are computed per
  request and never read from a store.
- **The rate limiter is in memory**, so limits are per instance rather than per
  deployment. Fine for a demo; not a defence against abuse.
- **The geocoder is keyless.** OpenStreetMap's Nominatim/Photon are
  community-funded and rate-limited. Fine for evaluation, and their usage policy
  asks you to move to a paid provider before real traffic.

Prices are **not** affected by any of the above.

## Making it production-grade

Add these in Vercel → Settings → Environment Variables. Each is independent.

| Variable                                                | Fixes                          |
| ------------------------------------------------------- | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Share links, session history   |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`    | Rate limiting across instances |
| `LOCATION_PROVIDER_API_KEY` + `NEXT_PUBLIC_MAP_KEY`     | Google or Mapbox geocoding     |
| `NEXT_PUBLIC_APP_URL`                                   | Absolute URLs in share links   |

`.env.example` documents every variable. `SETUP_REQUIRED.md` covers the
provider agreements needed for Uber, Lyft and Empower pricing.

Set `NEXT_PUBLIC_APP_URL` to your deployment URL once you have it — share links
are built from it.

## Notes for the platform

- **Node** is pinned by `engines.node` (>=20.9) and `.nvmrc` (22).
- **`maxDuration = 30`** on `/api/quotes` and `/api/quotes/stream`. The
  orchestrator budgets 8 seconds for upstream calls and enforces its own
  deadline; a 10-second platform default would kill a slow-but-succeeding
  comparison a moment before it answered.
- **No `vercel.json`.** Next.js is detected without one, and a config file that
  only restates defaults is a file that drifts from them.
- **Fixture data cannot be served in production.** `NODE_ENV=production` refuses
  `RIDELENS_DEMO_SOURCE` and `GEOCODER_PROVIDER=fixture` at boot, so a
  deployment cannot quietly show demo prices.

## Running it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Live prices, no keys.

To check a production build the way Vercel will run it:

```bash
npm run build && npm start
```

## Before you trust a number

```bash
npm run verify:all
```

Format, lint, types, 451 unit and integration tests, a production build, and
both end-to-end suites — one against fixtures, one against the live network with
no credentials at all.
