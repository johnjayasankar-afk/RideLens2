/**
 * Your own record.
 *
 * A server shell around a client panel, because the log lives in
 * localStorage and the server has never seen it — which is the point. The
 * page renders its heading and its explanation from the server and fills in
 * the rest once the browser can read its own storage.
 */

import type { Metadata } from "next";

import { TripsPanel } from "@/components/trips-panel";

export const metadata: Metadata = {
  title: "Your trips",
  description:
    "The comparisons you have run, kept on this device: what each route has cost, what you are watching, and how to export or delete it.",
  /* A page whose entire content is private to one browser has nothing to
     offer an index, and asking to be crawled would be slightly absurd. */
  robots: { index: false, follow: false },
};

export default function TripsPage() {
  return (
    <div className="shell trips">
      <header className="trips-head">
        <h1 className="trips-title">Your trips</h1>
        <p className="muted">
          Every comparison you run is recorded here so that, after a few looks, RideLens can say
          whether today is one of the cheaper ones for a route. It is a record of what you saw — not
          a forecast, and not market data.
        </p>
      </header>
      <TripsPanel />
    </div>
  );
}
