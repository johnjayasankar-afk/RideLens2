# RideLens — GitHub / Vercel package

Unzip, push to GitHub, deploy on Vercel. See `GITHUB_AND_VERCEL.md`.

## Quick local check

```bash
unzip ridelens-github-vercel.zip -d ridelens
cd ridelens
npm install
cp .env.example .env.local
npm run build
npm run start
```

Open http://127.0.0.1:3000

## Included

- Full Next.js RideLens source (`src/`, `public/`, configs)
- `.env.example`, README, SETUP_REQUIRED, deploy guide
- Unit/e2e tests (RideLens)

## Not included (by design)

- `node_modules/` — run `npm install`
- `.next/` — created by `npm run build`
- `.env.local` — secrets stay off GitHub; set env on Vercel
- `.archive-raildrop/` — legacy leftovers, not part of the product

Default live path: Photon places + OSRM routing + published rate cards.
