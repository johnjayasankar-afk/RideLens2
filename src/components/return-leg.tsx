"use client";

/**
 * The way back, which is not the same trip backwards.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The model already knows this and has never said it out loud. An          │
 * │ outer-borough → Manhattan leg carries a directional adjustment the       │
 * │ reverse does not; tolls are charged on one crossing and not the other;   │
 * │ the congestion zone is entered in one direction only. Two legs of the    │
 * │ "same" trip can differ by more than the spread between providers, and    │
 * │ anybody booking a return is quietly assuming they cannot.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── Why this is honest and the obvious version would not be ────────────────
 *
 * It prices the reverse route *now*. A real return happens later, when the
 * market has moved, so this is not a quote for the journey home and the copy
 * says so in as many words. What it is good for is the structural part — the
 * part that does not move with the hour — and that is what it claims.
 *
 * It runs the ordinary comparison endpoint with the endpoints swapped rather
 * than a bespoke path: the same sources, the same ranking, the same refusals.
 * A second implementation of pricing is a second thing to be wrong.
 */

import { useCallback, useRef, useState } from "react";

import { useWhenStill } from "./use-when-still";

import { formatMoneyMinor } from "@/lib/domain/money";
import { comparePrices } from "@/lib/domain/ranking";
import type { NormalizedQuote, QuoteSession } from "@/lib/domain/types";

type State =
  | { state: "loading" }
  | { state: "ready"; quotes: NormalizedQuote[] }
  | { state: "empty" }
  | { state: "failed" };

interface Props {
  session: QuoteSession;
  /**
   * The outbound option the return is measured against — the cheapest of
   * what is on screen.
   *
   * The quote itself rather than its price, because the honest comparison is
   * like for like. The board above may be filtered to Standard while the
   * reverse run asks for everything; cheapest-of-three against
   * cheapest-of-six would report a difference that is a filter, not a
   * direction. So the return is read at the same provider and product where
   * one exists, and the fallback says so.
   */
  outbound: NormalizedQuote | null;
  /**
   * The whole outbound board, so the panel can describe the trip rather than
   * one product of it.
   *
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ The headline was read off `outbound` alone — the cheapest on the board │
   * │ — and on a Manhattan comparison the cheapest is the yellow cab, whose  │
   * │ JFK fare is a published flat rate charged identically in both          │
   * │ directions. So the panel measured the one product that cannot be       │
   * │ asymmetric and reported "Both directions price the same, within what   │
   * │ this model can tell apart" while holding a reverse board where UberX,  │
   * │ Lyft, Uber Comfort, Lyft XL and UberXL were all materially cheaper     │
   * │ coming back. Reversing the same trip in the form made Lyft the         │
   * │ cheapest, and the identical panel then said "$19.59 more": one round   │
   * │ trip, two contradictory answers.                                       │
   * └────────────────────────────────────────────────────────────────────────┘
   */
  outboundAll?: readonly NormalizedQuote[];
}

function cheapest(quotes: readonly NormalizedQuote[]): NormalizedQuote | null {
  if (quotes.length === 0) return null;
  return quotes.reduce((best, q) => (q.rankingPriceMinor < best.rankingPriceMinor ? q : best));
}

function shortLabel(address: string): string {
  return address.split(",")[0] ?? address;
}

export function ReturnLeg({ session, outbound, outboundAll }: Props) {
  const [data, setData] = useState<State>({ state: "loading" });
  /* Priced once per comparison. Re-running it on every tab visit would
     double the cost of the page for a number that has not changed. */
  const askedFor = useRef<string | null>(null);

  const load = useCallback(() => {
    if (askedFor.current === session.id) return;
    askedFor.current = session.id;
    void run();
    async function run() {
      try {
        const res = await fetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pickup: { ...session.destination, query: session.destination.formattedAddress },
            destination: { ...session.pickup, query: session.pickup.formattedAddress },
            rankingMode: "cheapest",
            categoryFilter: "ALL",
            stream: false,
          }),
        });
        if (!res.ok) {
          setData({ state: "failed" });
          return;
        }
        const body = (await res.json()) as { session?: { quotes?: NormalizedQuote[] } };
        const quotes = body.session?.quotes ?? [];
        setData(quotes.length > 0 ? { state: "ready", quotes } : { state: "empty" });
      } catch {
        setData({ state: "failed" });
      }
    }
  }, [session.id, session.pickup, session.destination]);

  /*
   * Through the same gate every other optional fetch on this page uses.
   *
   * Not because the page might be scrolling — by the time this mounts a
   * reader has chosen its tab — but because starting a second full pricing
   * run straight out of an effect body is a synchronous setState the React
   * Compiler rejects, and the shared gate already schedules it properly.
   * There is no element to wait for: this renders one line until it has data.
   */
  useWhenStill(null, true, load, { deadlineMs: Infinity });

  if (data.state === "loading") {
    return (
      <p className="deck-empty muted" aria-live="polite">
        Pricing the way back…
      </p>
    );
  }
  if (data.state === "failed" || data.state === "empty") {
    return (
      <p className="deck-empty muted">
        {data.state === "failed"
          ? "The return leg could not be priced. The comparison above is unaffected."
          : "Nothing came back for the reverse route."}
      </p>
    );
  }

  /* The same product first, the cheapest only if that product did not come
     back at all on the reverse route. */
  const sameProduct =
    outbound == null
      ? null
      : (data.quotes.find(
          (q) =>
            q.provider === outbound.provider && q.providerProductId === outbound.providerProductId,
        ) ?? null);
  const back = sameProduct ?? cheapest(data.quotes)!;
  const likeForLike = sameProduct !== null;
  /* Shown as "from $X", which is what a band's low is. */
  const backLow = back.priceMinMinor;
  /*
   * The two directions, compared the way everything else in this app is.
   *
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ This subtracted one band's low from the other's low, ignored both      │
   * │ maxes, and called anything over a dollar material. So $16.37–$17.88    │
   * │ against $17.57–$19.15 — bands that overlap across most of their width  │
   * │ — printed "Coming back costs $1.20 more than going", a directional     │
   * │ claim the overlap does not support. The $1.00 floor was doing the job  │
   * │ of an overlap test and could not do it: two bands can differ by $1.20  │
   * │ at the low end and still be indistinguishable.                         │
   * └────────────────────────────────────────────────────────────────────────┘
   *
   * `comparePrices` is that test, already written and already property-tested,
   * and it yields a figure only where the bands are clear of each other —
   * which is the one case QUOTE_SEMANTICS.md:42 lets a direction be asserted.
   */
  const against = outbound != null && likeForLike ? comparePrices(back, outbound) : null;
  const delta =
    against && (against.relation === "more_expensive" || against.relation === "cheaper")
      ? (against.savingsMinor ?? null)
      : null;
  const material = delta != null && delta > 0;

  /*
   * The same comparison, run over every product that came back — so one
   * flat-rate fare cannot speak for a board that disagrees with it.
   */
  const board = (() => {
    if (!outboundAll || outboundAll.length === 0) return null;
    let dearer = 0;
    let cheaper = 0;
    let level = 0;
    for (const out of outboundAll) {
      const ret = data.quotes.find(
        (q) => q.provider === out.provider && q.providerProductId === out.providerProductId,
      );
      if (!ret) continue;
      const rel = comparePrices(ret, out).relation;
      if (rel === "more_expensive") dearer += 1;
      else if (rel === "cheaper") cheaper += 1;
      else level += 1;
    }
    const paired = dearer + cheaper + level;
    return paired >= 2 ? { dearer, cheaper, level, paired } : null;
  })();

  return (
    <div className="ret">
      <p className="ret-headline">
        {material ? (
          <>
            Coming back costs <strong>{formatMoneyMinor(delta!)}</strong>{" "}
            {against!.relation === "more_expensive" ? "more" : "less"} than going, on{" "}
            {back.providerProductName}.
          </>
        ) : against != null ? (
          <>Both directions price the same, within what this model can tell apart.</>
        ) : (
          /* Nothing to subtract from: either no outbound to compare, or the
             reverse route did not return the product the board is showing. */
          <>Here is the reverse route, priced on its own.</>
        )}
      </p>

      {board && board.dearer + board.cheaper > 0 ? (
        <p className="ret-board muted">
          Across the {board.paired} options priced both ways,{" "}
          {board.cheaper > 0 ? `${board.cheaper} come back cheaper` : null}
          {board.cheaper > 0 && board.dearer > 0 ? " and " : null}
          {board.dearer > 0 ? `${board.dearer} come back dearer` : null}
          {board.level > 0 ? `; the other ${board.level} price the same within their ranges` : null}
          .
        </p>
      ) : null}

      <ul className="ret-legs">
        <li className="ret-leg">
          <span className="ret-dir">
            {shortLabel(session.pickup.formattedAddress)} →{" "}
            {shortLabel(session.destination.formattedAddress)}
          </span>
          <span className="ret-price">
            {outbound != null ? (
              <>
                from {formatMoneyMinor(outbound.priceMinMinor)}
                <span className="muted"> · {outbound.providerProductName}</span>
              </>
            ) : (
              "—"
            )}
          </span>
        </li>
        <li className="ret-leg is-return">
          <span className="ret-dir">
            {shortLabel(session.destination.formattedAddress)} →{" "}
            {shortLabel(session.pickup.formattedAddress)}
          </span>
          <span className="ret-price">
            from {formatMoneyMinor(backLow)}
            <span className="muted"> · {back.providerProductName}</span>
          </span>
        </li>
      </ul>

      {!likeForLike && outbound != null ? (
        <p className="party-note">
          {outbound.providerProductName} did not come back on the reverse route, so these two rows
          are different products and the difference between them is not a direction.
        </p>
      ) : null}

      <p className="deck-foot muted">
        Priced now, in the other direction — not a quote for a journey later. What it is good for is
        the part that does not move with the clock: tolls charged on one crossing and not the other,
        a congestion zone entered one way, and the directional adjustment the model applies between
        the outer boroughs and Manhattan. Book it when you need it and the figure will have moved;
        the asymmetry will not.
      </p>
    </div>
  );
}
