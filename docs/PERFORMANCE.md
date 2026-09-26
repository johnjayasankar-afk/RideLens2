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

(Measured against the CDN build; removing the CDN stylesheet link brought the
same page to 259.6 KB.)

## The map is the elephant

Rendering a comparison loads MapLibre GL. It is the largest single thing this
app ships:

|                                     |                               |
| ----------------------------------- | ----------------------------- |
| Lazy chunk, gzipped                 | **287.5 KB**                  |
| Initial JS, gzipped, for comparison | 166.4 KB                      |
| Loaded                              | Only when a map renders       |
| Source                              | `maplibre-gl@6.11.2`, bundled |

**The map weighs more than the rest of the application put together.** It is
lazily imported, so first paint is untouched and a page with no map never
pays for it — but it is not a small thing and the budget tracks it on its own
line rather than folding it into a number that would then need a footnote.

### It used to come from a CDN, and that was worse than it looked

Until now `route-map.tsx` injected a `<script>` from `unpkg.com` and read
`window.maplibregl` off the global. That ran 800 KB of third-party code on
this origin, made the map an uptime dependency on a CDN, and — the part that
mattered — kept it invisible to `npm audit`.

**The moment it became a real dependency, audit reported a _critical_ XSS
advisory** (GHSA-jrc7-96c5-q579, sanitizer bypass in `DOM.sanitize()`)
against every version at or below 6.4.0. That included the 4.7.1 the app had
been serving to users the whole time. Nothing in the project could have told
anyone, because nothing in the project knew the package existed.

Fixed in 6.11.2, which is what is installed. `npm audit` reports zero
vulnerabilities.

The upgrade cost weight — v4 was 207 KB gzipped, v6 is 287.5 KB. That is a
40% increase to clear a critical advisory, and it is worth it.

### Two things the move needed

**The stylesheet had to go in the lazy chunk.** A top-level
`import "maplibre-gl/dist/maplibre-gl.css"` in a client component is hoisted
into the route's own stylesheet, which took the CSS budget from 12 KB to
33 KB and shipped map styles to every page including those with no map. The
budget caught it on the first run. It now lives in `map-lib.ts`, imported
alongside the library, so it travels with the chunk that only loads when a
map does.

**The worker had to be self-hosted.** v6 decodes tiles in a module worker and
resolves its URL relative to its own module; the bundler does not emit that
as a served asset, so the request fell through to the app's 404 page, the
browser refused a script served as `text/html`, and the map drew a blank
canvas. `scripts/vendor-map-worker.ts` copies the worker and the shared chunk
it imports into `public/vendor/maplibre/` on every build, and `map-lib.ts`
calls `setWorkerUrl` at it. Copied at build time rather than committed, so it
cannot drift from the installed version — `public/vendor/` is gitignored.

**Third-party requests are now only map tiles**, from CARTO. No script from
anywhere but this origin.

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

The script measures gzipped bytes and cross-checks cleanly against what the
browser reports (166.4 vs 167.1 KB JS, 12.1 vs 12.4 KB CSS, measured live).

CSS is read from the root page's RSC manifest rather than by summing every
`.css` under `static/`. Summing counted the lazily-imported map styles against
the page and reported 33 KB for a page that downloads 12.

MapLibre has its own line rather than being folded into `clientJs`, because
it is lazily imported and costs nothing until a map renders — but at more
than the rest of the app combined it is not something to leave unmeasured.
Its ceiling is generous because it is one upstream package whose size we do
not control; it exists to catch the chunk being pulled into the initial
bundle by accident, or doubling again.

## How it feels

Measured on a production build at 1440x900, scrolling a full comparison.

|                               |    Before |        After |
| ----------------------------- | --------: | -----------: |
| Median frame                  |   25.0 ms |   **8.3 ms** |
| 95th percentile frame         |   50.0 ms |   **9.3 ms** |
| Frames missing a 60 Hz budget |       87% |      **~0%** |
| Frames over 33 ms             | 51 of 119 |        **0** |
| Scroll rate                   |   ~40 fps | **~120 fps** |
| Layout shift                  |    0.0223 |   **0.0053** |
| Long tasks while scrolling    |         — |        **0** |

`npm run perf` measures all of it and fails on a regression. Reverting the
one-line fix below trips it immediately.

### One CSS property cost two thirds of the frame rate

`labs-ui` dresses surfaces in glass, and on Chromium it can bend the backdrop
through an SVG lens — `backdrop-filter: url(#lgl-1)` — instead of a plain
blur. The topbar had one.

A `backdrop-filter` that resolves to a `url()` takes the SVG filter path,
which has none of the fast paths a native `blur()` gets, and a **sticky**
element is re-composited on every scroll frame. So the browser was running an
SVG filter pipeline sixty times a second over the full width of the page.

Isolated by elimination, three runs each:

|                                   |     fps | frames over 33 ms |
| --------------------------------- | ------: | ----------------: |
| As shipped                        |      40 |                45 |
| Topbar lens → native `blur(16px)` | **120** |             **0** |
| Topbar blur removed entirely      |     120 |                 0 |
| Only the topbar lens kept         |      40 |                44 |
| Box-shadows removed               |      40 |                42 |
| One-second clock stopped          |      40 |                39 |
| Map removed                       |      40 |                43 |

Nothing else mattered. Not the shadows, not the React re-render every second,
not the WebGL map.

`labs-ui` already refused a lens on a pane above 420,000 px², reasoning that
it "cannot carry a lens every frame". The topbar is 86,000 px² — a fifth of
that — and was waved through. **Area is what a lens costs once; being pinned
is what makes it cost sixty times a second.** The rule is now explicit:
sticky or fixed, no lens. It falls back through `--gl-fx` to the frosted
glass the material already defines, so the tint, the rim of light and the
pointer highlight are untouched. On a 60px strip the refraction was not
visible anyway.

### The map now waits for a quiet moment

Building a WebGL map, compiling the style's layers and decoding the first
tiles costs ~650 ms of the ~820 ms of long tasks a page load produces. None
of it delays first paint, because the module is lazy — which is exactly the
problem. It landed _after_ the comparison appeared, which is when somebody
starts scrolling it. Measured scrolling from the moment the cards showed, the
worst frame was **1.6 seconds**. The median was a healthy 119 fps and it did
not matter at all: one frozen second is the thing a person remembers.

`requestIdleCallback` alone does not fix it, because its timeout fires
regardless — straight into the scroll it was meant to avoid. The map now
refuses to build while the page has scrolled in the last 220 ms, and waits
until it is near the viewport at all. A deadline guarantees it always
arrives.

Worst frame during early scrolling went from 1.6 s to 130–650 ms, and in the
ordinary case — land, read for a moment, then scroll — the map is already up
and scrolling produces **no long tasks at all**.

### Nothing moves while it loads

Layout shift was 0.0223, all of it in one place: the comparison jumping down
as content arrived above it. Three causes, each found by watching element
heights rather than guessing.

- **The modeled-estimate banner** appears only once every quote is known to be
  modeled, so ~76 px arrived late. It has a reserved slot now, held open only
  while loading — if a partner source is ever enabled the banner will not
  apply, and a permanent gap would be worse than the shift.
- **The market strip and takeaway** added ~246 px on desktop and ~410 px on a
  phone. They have a skeleton built from their own classes rather than a
  pixel height, because the stats row rewraps below ~560 px and any number
  would be wrong on one side of it.
- **The trip stats** grew from two cells to five, because miles and drive time
  come from the route while wait and price come from the quotes. Every cell
  now renders from the start and fills in place.

Two of those had a sting in the tail. The first reserve was a round 76 px
against a banner measuring 75.5 — half a pixel, enough to move every row
below it. Reserve and banner are pinned to one CSS variable now so they
cannot drift. And the shimmer standing in for a stat was 12 px where the
number is 24, so the _labels_ moved while the row's own height never changed
— which is why it stayed hidden until a shift report named `span.stat-label`
as the thing that moved.

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
