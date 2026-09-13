# RideLens

Every ride. One comparison.

Compare Uber, Lyft, Empower, and Curb with live routing and published rate-card estimates — before you book.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000)

1. Search **From** and **To** (or use Quick fill).
2. RideLens maps the route and lines up estimates side by side.
3. Rank by Price / Soonest / Value, then open the provider to book.

Default location search uses **Photon** (no API key). Routing uses public **OSRM**. Fare math uses published rate cards when `RATE_CARD_SOURCE_ENABLED=true`.

## Environment

See `.env.example` and `SETUP_REQUIRED.md`.

## Scripts

```bash
npm run dev
npm run build && npm run start
npm run test
npm run verify
```
