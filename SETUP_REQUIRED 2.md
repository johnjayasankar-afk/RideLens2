# RideLens setup

## Required

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Canonical URL |
| `LOCATION_PROVIDER` | Prefer `photon` |
| `RATE_CARD_SOURCE_ENABLED` | `true` for live rate-card estimates |
| `OSRM_BASE_URL` | Default public OSRM is fine for demos |
| `RIDELENS_ADMIN_SECRET` | Required in production for `/admin` |

## Optional partner feeds

Only enable with written authorization: Obi, Lyft, Uber, Empower, Curb keys.

Never set `RIDELENS_ALLOW_FIXTURES=true` in production.

Copy `.env.example` → `.env.local` to start.
