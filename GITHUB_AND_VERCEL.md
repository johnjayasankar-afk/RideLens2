# GitHub + Vercel — RideLens

This folder is the complete RideLens app. You do not need `node_modules` or `.next`.

## 1. Create the GitHub repo

1. Go to [https://github.com/new](https://github.com/new).
2. Name it `ridelens` (or similar). Keep it private if you want.
3. Do **not** add a README, `.gitignore`, or license on GitHub.
4. Unzip this project, then:

```bash
cd ridelens
git init
git add .
git commit -m "Add RideLens v1"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ridelens.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

## 2. Deploy on Vercel

1. Go to [https://vercel.com/new](https://vercel.com/new).
2. Import the `ridelens` GitHub repo.
3. Framework: **Next.js**. Build command: `next build` (default).
4. Add environment variables before the first production deploy:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | your Vercel URL, e.g. `https://ridelens.vercel.app` |
| `LOCATION_PROVIDER` | `photon` (no key) |
| `RATE_CARD_SOURCE_ENABLED` | `true` |
| `OSRM_BASE_URL` | `https://router.project-osrm.org` |
| `RIDELENS_ADMIN_SECRET` | output of `openssl rand -hex 24` (recommended) |

Optional later (partner APIs — see `SETUP_REQUIRED.md`): `OBI_*`, `UBER_*`, `LYFT_*`, `EMPOWER_*`, `CURB_*`, Mapbox/Google keys.

5. Deploy. Open the production URL and compare a From → To trip.

## Notes

- Keyless live estimates work without Uber/Lyft API keys (OSRM + published rate cards).
- Do **not** upload `.env.local` to GitHub; use Vercel env settings.
- `/admin` is gated when `RIDELENS_ADMIN_SECRET` is set (`/admin?secret=…`).
- There is **no** `postinstall` Playwright step — Vercel only needs `next build`.
