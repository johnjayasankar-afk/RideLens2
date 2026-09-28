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
}

function cheapest(quotes: readonly NormalizedQuote[]): NormalizedQuote | null {
  if (quotes.length === 0) return null;
  return quotes.reduce((best, q) => (q.rankingPriceMinor < best.rankingPriceMinor ? q : best));
}

function shortLabel(address: string): string {
  return address.split(",")[0] ?? address;
}

export function ReturnLeg({ session, outbound }: Props) {
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
  const backLow = back.priceMinMinor;
  const delta = outbound != null && likeForLike ? backLow - outbound.priceMinMinor : null;
  /*
   * Under a dollar the two directions are the same price as far as anything
   * here can tell, and "$0.40 more" invites a reader to believe a precision
   * the band around each figure does not support.
   */
  const material = delta != null && Math.abs(delta) >= 100;

  return (
    <div className="ret">
      <p className="ret-headline">
        {material ? (
          <>
            Coming back costs <strong>{formatMoneyMinor(Math.abs(delta!))}</strong>{" "}
            {delta! > 0 ? "more" : "less"} than going, on {back.providerProductName}.
          </>
        ) : delta != null ? (
          <>Both directions price the same, within what this model can tell apart.</>
        ) : (
          /* Nothing to subtract from: either no outbound to compare, or the
             reverse route did not return the product the board is showing. */
          <>Here is the reverse route, priced on its own.</>
        )}
      </p>

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
