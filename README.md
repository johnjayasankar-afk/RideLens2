# RideLens

Every ride. One comparison.

Compare Uber, Lyft, Empower, and Curb with live routing, published rate cards, and a simulated marketplace that moves with time of day, hotspots, and weather — before you book.

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

Default location search uses **Photon** (no API key). Routing uses public **OSRM**. Fare math uses published rate cards when `RATE_CARD_SOURCE_ENABLED=true`, plus a marketplace model (~55s ticks). Auto-refresh arms after your first successful compare.

## Your own record

Every completed comparison is kept on your device, and nowhere else — the
route, the date, and the bands each provider showed. After three looks at the
same trip, RideLens can tell you where today sits against what _you_ have
seen, which is the one form of context a model cannot invent for itself.

- **⌘K** opens the command palette: your trips first, then places, ranking,
  filters, theme and actions. There is a **Commands** button for anyone
  without a keyboard.
- **/trips** is the record — what each route has cost, what you are watching,
  and CSV or JSON export.
- **"Tell me when it drops"** sets a threshold that is checked when you next
  open RideLens. Nothing runs in the background and nothing is sent to you;
  a test refuses the disclosure if it ever implies otherwise.

None of it is transmitted, all of it expires, and every route has a Forget
control beside it. See `docs/SECURITY.md`.

## Ask about a comparison

Set `ANTHROPIC_API_KEY` and an assistant appears under the best price. It can
explain the fee stack, say why one provider is dearer, tell you what a band
means, and read your own history back to you — and it can act: re-run the
comparison, swap the trip, re-rank, filter, set a price watch.

What it cannot do is invent a number. It is handed a brief of the figures
already on your screen, with money pre-formatted as the strings you are
looking at, and told it may not state a figure outside it, average a band,
name a winner when two ranges overlap, or call a modelled estimate a live
quote. Its five actions are things you can already do with one tap; it
returns an intent, which is validated on the server, validated again in the
browser, and then run through the same path the command palette uses. It
cannot book, pay, send, share or delete — and a test greps the whole tool
surface to keep it that way.

The key is read server-side and never reaches the browser. Your trip log is
sent with the question and is not stored; no transcript is kept. Without a
key the assistant is hidden rather than broken.

## Telling the model whether it was right

RideLens rests on a modelled number, and `docs/CALIBRATION.md` has said since
it was written that the model has never been measured against a real fare.
The machinery to find out existed; it asked at the wrong moment. The question
"what did you actually pay?" lived on the booking handoff — the page shown
_while you are being sent to the provider_ — so it arrived before the trip
had happened, and a rider who came back later was told the comparison had
expired.

Now RideLens notes which option you opened, and asks on your next visit, once
the trip has had time to finish. It states its own estimate before asking.
The answer stays on your device, and at twenty reports it can tell you how
its estimates have done **for you**: how often the band contained the fare,
where inside the band fares landed, and how far the misses missed by. Below
twenty it says so instead of showing an average, for the same reason the
published corpus withholds one.

Contributing to that shared corpus is a separate, explicit action. It sends
the distance, the hour, the provider, the band, the fare, and a one-way hash
of the route — no addresses and no coordinates. Because the session is long
gone by then, each prediction is signed when it is made and verified when it
comes back, so nothing a client can edit enters the corpus. Set
`RIDELENS_REPORT_SECRET` to enable it.

Ranges are refused below three observations, and comparisons made by
different `MODEL_VERSION`s are counted apart rather than pooled — a figure
spanning two estimators is a figure no estimator ever produced.

## Environment

See `.env.example` and `SETUP_REQUIRED.md`.

## Scripts

```bash
npm run dev
npm run build && npm run start
npm run test
npm run verify        # format, lint, types, tokens, unit, build, budget
```

Four standing guards, each written after the thing it catches shipped:

```bash
npm run tokens          # dark blocks agree; no undefined or self-referential var()
npm run budget          # gzipped client JS, CSS, fonts, lazy map
npm run contrast        # six OS x choice combinations at WCAG 2.2 AA
npm run perf            # frame times and CLS while scrolling
npm run snapshot:model  # rewrite the committed fares after an intended change
```

The model has no ground truth to be scored against — see `docs/CALIBRATION.md`
— so it is held to coherence instead. Two fuzzers assert what must be true of
every fare and every comparison, and 125 canonical fares are checked in, so a
change to a coefficient shows up in the diff as the prices it moves rather than
as the coefficient alone:

```
soho→jfk | weekday_offpeak | uber/uberx   $81.00–87.40 → $81.67–86.73  (+0.67, +0.8%)
```

`contrast` and `perf` need a running build (`npm run build && npm run start`).
`contrast` seeds a trip log and opens the palette so the surfaces that only
exist under some condition are measured too — and fails if one of them never
rendered, because an audit of an empty page reports zero failures and means
nothing.
