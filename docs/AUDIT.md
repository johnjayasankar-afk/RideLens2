# RideLens correctness audit

Audited **2026-09-25** against commit `f47153c` ("vfinallll"). Every claim below
was checked against the code or against a running build — nothing is repeated
from memory or from the brief without verification, and where the brief and the
code disagreed, the code won.

---

## Baseline: the gate was red before any work started

`npm run verify` = `format:check && lint && typecheck && test && build`.

| Step           | At `f47153c`                | Now                                                             |
| -------------- | --------------------------- | --------------------------------------------------------------- |
| `format:check` | ❌ 55 files unformatted     | ✅                                                              |
| `lint`         | ❌ 11 errors, 5 warnings    | ⚠️ 9 errors, 6 warnings — see [Deferred](#deferred-to-phase-41) |
| `typecheck`    | ✅                          | ✅                                                              |
| `test`         | ✅ 12 tests, 1 file         | ✅ 35 tests, 3 files                                            |
| `test:e2e`     | ❌ could not pass — see 0.2 | ✅ 10 passing                                                   |
| `build`        | ✅                          | ✅                                                              |

The repo had never been run through its own Prettier config, so the first step
of its own verification script failed on a clean checkout.

---

## 0.1 Broken social previews in production — HIGH, fixed

**Confirmed, and worse than reported.** Four files disagreed about where the
site lives:

| File                                  | Fallback                |
| ------------------------------------- | ----------------------- |
| `src/app/layout.tsx` (`metadataBase`) | `http://127.0.0.1:3000` |
| `src/app/robots.ts`                   | `http://127.0.0.1:3000` |
| `src/app/sitemap.ts`                  | `https://ridelens.app`  |
| `src/lib/config.ts`                   | `http://localhost:3000` |

`NEXT_PUBLIC_APP_URL` is not set in the deployment, so `og:image` and
`twitter:image` resolved against the loopback address of whoever opened the
link. Every share on every platform was broken.

**Fixed.** `appOrigin()` in `config.ts` resolves `NEXT_PUBLIC_APP_URL` →
`VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → `localhost`, normalising a bare
host into an origin. It is now the single source for `metadataBase`, robots and
sitemap. `assertPublicOrigin()` throws when a production build can only describe
itself by loopback.

**A second bug found while verifying.** `robots.ts` and `sitemap.ts` were
statically prerendered, so they baked in whatever origin existed at _build_
time — a production bundle built without the variable would advertise a sitemap
on the reader's own machine. Both are now `force-dynamic`. Verified against a
running build: with `VERCEL_PROJECT_PRODUCTION_URL=ridelens.app` and
`NEXT_PUBLIC_APP_URL` empty, `og:image`, `robots.txt` and `sitemap.xml` all
resolve to `https://ridelens.app`.

**Related.** `geocoder.ts` built its Nominatim `User-Agent` from the same raw
variable. OSM's usage policy asks for a contactable identifier and a loopback
address identifies nobody; it now follows `appOrigin()`.

Covered by 13 tests in `tests/unit/config-origin.test.ts`.

---

## 0.2 E2E suite could not pass — confirmed, fixed

Three independent faults:

1. `playwright.config.ts` started the server with `E2E_TEST=1`. `config.ts` has
   no such key — fixtures are gated on `RIDELENS_ALLOW_FIXTURES`. Fixtures were
   never enabled and every run hit the live rate-card path.
2. **Not in the brief:** fixtures are _added_ to the enabled sources, not
   substituted for them (`registry.ts:discoverEnabledSources`). Even with
   fixtures correctly enabled, a modeled rate-card quote whose price moves with
   traffic, time of day and weather competes with them, so
   `quotes[0].provider === "empower"` remains a coin toss. The E2E server now
   also sets `RATE_CARD_SOURCE_ENABLED=false`, which is the only way that
   assertion can be deterministic.
3. The mobile test asserted `getByText("Every ride. One live comparison.")` was
   visible. That string appears nowhere in the codebase, and the real tagline
   (`"Every ride. One comparison."`) lives only in the document title and the OG
   image — it is never rendered into the DOM. The assertion was wrong twice
   over.

The old fixture test also contained a dead `page.evaluate(() => {})`, three
comments describing what the author could not get working, and a fallback that
abandoned the form and called the API directly.

**Fixed and expanded** to 5 specs × 2 viewports: ranking is ordered rather than
merely correct at the head, every quote carries the semantics the UI reads,
health never reports a credential-gated source as enabled, and the phone layout
does not overflow sideways. 10 passing — the first green E2E run this repo has
had.

---

## 0.3 Product spec is the wrong product — confirmed, and it is three documents

The brief flagged `docs/PRODUCT_SPEC.md`. Two more are RailDrop's as well:

| Document                     | RailDrop/Amtrak terms | RideShare terms | First line                 |
| ---------------------------- | --------------------- | --------------- | -------------------------- |
| `docs/ARCHITECTURE.md`       | 14                    | 0               | `# RailDrop architecture`  |
| `docs/PRODUCT_SPEC.md`       | 9                     | 0               | `# RailDrop product spec`  |
| `docs/TEST_PLAN.md`          | 9                     | 0               | `# RailDrop test plan`     |
| `docs/DATA_SOURCE_MATRIX.md` | 0                     | 10              | genuine, detailed, current |
| `docs/QUOTE_SEMANTICS.md`    | 0                     | 3               | genuine, and load-bearing  |

This matters beyond tidiness: the brief instructs a reader to treat
`ARCHITECTURE.md` as authoritative context before touching anything, and it
describes a train fare-watching product.

`PRODUCT_SPEC.md` and `ARCHITECTURE.md` rewritten. `TEST_PLAN.md` still
describes RailDrop — see [Remaining](#remaining-in-phase-0).

---

## 0.4 In-memory rate limit and cache — confirmed, partly fixed

Both were module-level `Map`s. Two distinct consequences, worth separating:

**Lifetime — fixed.** Neither ever removed a key. `rate-limit.ts` filtered
expired timestamps out of a bucket and then wrote the empty bucket back, so
every caller that ever hit it was retained for the life of the instance.
`cache.ts` deleted an entry only if someone happened to read it after expiry —
an entry written once and never read again was never freed.

Both now sit on `MemoryTtlStore` (`src/lib/quotes/store.ts`): a sweep on write,
at most once per interval, plus a hard cap with LRU eviction. Deliberately no
background timer — an interval keeps a serverless instance alive and does
nothing while the process is frozen between invocations.

**Scope — not fixable in memory.** Each instance holds its own map, so a
30/minute limit is 300/minute across ten instances. `MemoryTtlStore` implements
a `TtlStore` interface so a Supabase- or KV-backed version is a drop-in. Until
then the limiter is a courtesy, not a control. Documented in `ARCHITECTURE.md`.

**Also fixed (flagged under 4.7).** `cacheGet` carried the comment _"Never serve
account-linked cache to public key space (belt & suspenders)"_ directly above a
bare `return entry.value`. There was no check. The real protection was
`cacheSet`'s refusal to write plus the key builder putting account context and
user id into the key — genuine, but entirely upstream, so nothing at the read
could have caught a malformed key. The read refuses now too, and
`tests/unit/store.test.ts` attempts the bleed from both directions.

---

## 0.5 MapLibre from unpkg at runtime — confirmed, NOT fixed (needs approval)

`src/components/route-map.tsx:65-66` injects both a stylesheet and a script from
`https://unpkg.com/maplibre-gl@4.7.1/…` at runtime. No SRI, third-party
availability on the render path, and `maplibre-gl` is absent from
`package.json`.

It has a second cost the brief did not mention: the staged CSP in
`next.config.ts` has to allowlist `https://unpkg.com` in **both** `script-src`
and `style-src` to permit it. Bundling the library removes two entries from the
policy and makes the nonce-based CSP in 4.7 tractable.

**Blocked deliberately.** The fix is to add `maplibre-gl` as a dependency, and
the brief says to ask before adding a runtime dependency. Not done pending that.

---

## 0.6 Admin secret in query string — confirmed, fixed

`/admin` accepted `?secret=…`, and the unauthorized page _instructed_ people to
use it (`"open /admin?secret=…"`). That writes the credential into every proxy
access log, the browser history, and the `Referer` of every outbound link on the
page.

Replaced with a POST form and an `httpOnly`, `sameSite=strict` cookie scoped to
`/admin`; the `x-admin-secret` header still works for automated callers.
Comparison is timing-safe. A secret arriving in the query string is now
redirected away rather than honoured, so an old bookmark stops working instead
of quietly continuing to authenticate.

**The brief asked whether the page's no-secret branch matches the API's. It
does** — both are `env.NODE_ENV !== "production"`. Verified against a production
build with no secret configured: `/admin` renders the sign-in form and serves no
data, and `/admin?secret=guess` returns `307 → /admin`.

---

## 0.7 Unoptimized provider logos — confirmed, fixed (different reason)

`provider-logo.tsx` used a raw `<img>`, but it already set `width` and `height`,
so layout shift — the brief's stated reason — was not actually occurring.

The real waste was the assets. Three variants per provider were committed, and
the bare `{slug}.png` was a **byte-identical copy** of `{slug}-256.png`
(`lyft.png` and `lyft-256.png` are both exactly 25,322 bytes) referenced from
nowhere. `other.png` did not exist at all, so the 1x set was not even complete.

Now `next/image` over a single 256px source, which also re-encodes 8–25KB PNGs
displayed at 24–40px. Nine files deleted, five kept. `sizes` is deliberately
omitted: on a fixed-size image it makes Next emit the full device-width srcset —
fifteen candidates up to 3840w for a 32px mark, on six marks a page. Verified in
rendered HTML: now `1x, 2x`.

---

## 0.8 `.DS_Store` — confirmed, fixed, and it was the smaller half

`.DS_Store` was tracked in `HEAD`. The larger problem was in the index: **32,451
`node_modules` files and 448 `.next` files were staged for commit**, with a
`.gitignore` covering all three sitting unstaged beside them. One `git commit`
away from a catastrophic diff.

Index cleaned (32,451 → 19 real files), `.DS_Store` untracked, `.gitignore`
committed.

---

## Deferred to Phase 4.1

Seven ESLint errors remain, all `set-state-in-effect`, all inside the two
monoliths the brief already scopes for decomposition:

| File                | Line     | Rule                                                            |
| ------------------- | -------- | --------------------------------------------------------------- |
| `compare-form.tsx`  | 211      | `set-state-in-effect` — mount hydration from URL + localStorage |
| `compare-form.tsx`  | 500      | `set-state-in-effect` — deep-link one-shot compare              |
| `compare-form.tsx`  | 508      | `set-state-in-effect` — reset-on-input-change                   |
| `compare-form.tsx`  | 575, 582 | `set-state-in-effect` — compare-after-swap / after-recent       |
| `compare-form.tsx`  | 665 ×2   | `refs-during-render` — `lastComparedKey.current` read in render |
| `quote-results.tsx` | 424      | `set-state-in-effect` — entrance animation                      |
| `quote-results.tsx` | 479      | `set-state-in-effect` — marketplace tick countdown              |

The two `refs-during-render` errors that were also here **have been fixed**,
because they were a real defect rather than a flagged pattern:
`lastComparedKey` is a ref, mutating a ref schedules no re-render, and render
read it to decide whether to show the mobile compare button — so that button's
visibility could disagree with what had actually been compared. The ref is kept
for async reads, where a stale closure would compare against the wrong route,
and is mirrored into state for render.

The seven that remain are the `useCompareSession` / `useDeepLinkState`
extractions in 4.1. They need to move together, in a 1,024-line component with
almost no coverage protecting it, and suppressing them to turn the gate green
would be worse than leaving them visible.

**`npm run verify` therefore still exits non-zero on `lint`.** Every other step
passes.

---

## Remaining in Phase 0

- **0.5** — blocked on approval to add `maplibre-gl` (see above).
- **0.9** — the full functionality sweep has not been run. It needs a live
  geocoder, a live OSRM and manual exercise of ~25 flows; it is the largest
  single item in Phase 0 and has not been started.
- `docs/TEST_PLAN.md` still describes RailDrop.

---

## Observations outside the brief's list

- **The meta description overclaims.** `layout.tsx` ships _"Compare Uber, Lyft,
  Empower, and Curb with live routing, marketplace-aware fare estimates, and
  pickup waits — before you book."_ Not one of those four providers is an
  enabled source; every number comes from the rate-card model. This is the same
  problem Phase 1.2 addresses in the UI, and it is arguably worse in metadata
  because it is what a search result and a link preview show. Not changed here —
  it belongs with Phase 1.
- **Dead branches in `comparePrices`.** `ranking.ts:88-96` is unreachable.
  `bothHigh` requires both ranges to be zero-width, and two zero-width ranges
  that differ are already caught by the non-overlap branches above, so `delta`
  can only ever be `0` by the time that code runs. Harmless, but it reads as if
  it handles a case it never sees.
- **A magic threshold.** `ranking.ts:106` treats a sub-`200`-minor-unit
  difference as "similar" with no named constant and no comment.
- **Uncommitted work was present.** A wired-in "Labs glass" material
  (`labs-glass.css`, `labs-ui`, imported by `layout.tsx`) sat staged and
  uncommitted. It was committed unchanged as its own reversible commit so later
  work had a clean base; it has not been reviewed.
