# Performance

Measured 2026-09-25 against a production build, from the browser's own
resource timings rather than from a bundler's report — transfer sizes, not
raw ones, because transfer is what somebody waits for.

## What the page costs

Loading `/` with no comparison run:

|            |  Files |  Transferred |  Decoded |
| ---------- | -----: | -----------: | -------: |
| JavaScript |     10 | **167.2 KB** | 539.5 KB |
| Fonts      |      3 |  **77.3 KB** |  76.4 KB |
| CSS        |      1 |  **12.4 KB** |  54.1 KB |
| Images     |      8 |       6.0 KB |   3.6 KB |
| HTML       |      1 |       5.4 KB |        — |
| **Total**  | **23** | **266.3 KB** |          |

**Third-party requests on first load: zero.** Fonts are self-hosted and
subset, provider logos are local, and there is no analytics, no tag manager
and no font CDN. That is unusual and worth keeping.

## The map is the elephant

Running a comparison loads MapLibre GL from `unpkg.com`:

|                    |                                                           |
| ------------------ | --------------------------------------------------------- |
| Raw                | 803 KB                                                    |
| Gzipped            | **207 KB**                                                |
| Source             | `https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js` |
| In `package.json`? | **No**                                                    |

**The map costs more than the entire rest of the application.** 207 KB
gzipped against 167 KB for everything else — it more than doubles the page's
JavaScript, and it arrives from a third party.

It is at least loaded lazily: nothing fetches it until a comparison renders,
so the first paint is unaffected. And `docs/A11Y.md` establishes that no task
requires the map — it is supplementary.

Four things follow, in descending order of how much they matter:

1. **It executes third-party code on this origin.** Now pinned with
   subresource integrity, so the browser refuses anything that is not the
   exact bytes npm published for 4.7.1. Before that, whatever unpkg returned
   for that path ran with full access to the page, and the CSP permitting it
   is report-only, so nothing was checking anything. The hashes were derived
   from the registry tarball — whose published `dist.integrity` was verified
   against the downloaded bytes — and not merely from what the CDN happened to
   serve.
2. **It is an uptime dependency on unpkg.** If unpkg is slow or down, the map
   fails. It degrades rather than breaking the page, which is the right
   behaviour, but it is an availability surface nobody chose.
3. **It reveals users to two third parties.** Every comparison tells unpkg
   and CARTO the user's IP and referer, and the CARTO tile requests describe
   the route being viewed. That is a privacy fact, not a performance one, but
   it arrives with the same decision.
4. **It is not a dependency**, so `npm audit` does not see it, Dependabot
   does not watch it, and the version is a string in a component file.

**Recommendation: add `maplibre-gl` to `package.json` and bundle it.** That
removes the CDN, the integrity question and the uptime dependency in one
move, at the cost of a runtime dependency — which this project requires a
decision on rather than a commit. Self-hosting the basemap style would be a
separate, larger piece of work.

## The budget

`npm run budget`, and part of `npm run verify`:

| Budget             | Measured | Headroom |
| ------------------ | -------: | -------: |
| Client JS, gzipped | 166.4 KB |   200 KB |
| CSS, gzipped       |  12.1 KB |    20 KB |
| Fonts, gzipped     |  76.4 KB |    95 KB |

Each ceiling is roughly 15% above what the page measures today — room to
work, not room to drift. Going over fails the build, which is the point: a
budget nobody enforces is a preference, and the argument about a heavier page
should happen when somebody makes it heavier rather than a year later when
the cause is unrecoverable.

The script measures gzipped bytes from `.next/build-manifest.json` and
cross-checks cleanly against what the browser reports (166.4 vs 167.2 KB
measured live — the difference is Next's runtime bootstrap inline in the
HTML).

**It deliberately excludes MapLibre**, which would otherwise be a 207 KB
footnote attached to every number quoted from this table. The map's cost is
stated above, on its own, where it cannot be skimmed past.

## Where the time goes

The comparison is not bounded by the bundle. Per request:

- `POST /api/quotes` runs enabled sources concurrently, with
  `QUOTE_REQUEST_TIMEOUT_MS` at 8s. A slow source degrades the comparison
  rather than blocking it.
- `GET /api/route` calls OSRM. This is the real latency floor for a cold
  route, and it is a public demo server.
- Results stream, so cards paint as sources answer rather than after the
  slowest one.
- `QUOTE_CACHE_TTL_SECONDS` is 12, and the cache is keyed by account context
  so a public key can never read a personalised fare — see
  `tests/unit/store.test.ts`.

## Not measured

- **No Lighthouse or Core Web Vitals run.** LCP, CLS and INP are unmeasured.
  The scripted probe could not read a paint timing from this build, so even
  FCP is unrecorded here.
- **No cold-cache mobile measurement**, and no throttled network. Every
  number above came from a local loopback connection, which is the most
  flattering condition available.
- **No server-side latency distribution.** `/api/admin/overview` reports a
  p50 field that is currently always null.
- **No bundle composition analysis.** 539 KB decoded for a page this size
  suggests something is larger than it needs to be, and nothing here says
  what.
- **No regression history.** The budget catches a jump past a ceiling; it
  does not show a trend.
