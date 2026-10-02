"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ProviderLogo } from "@/components/provider-logo";
import { isAllowedBookingUrl } from "@/lib/booking/allowed-hosts";
import type { ProviderId } from "@/lib/domain/types";

const KNOWN = new Set(["uber", "lyft", "empower", "curb"]);

function asProvider(raw: string): ProviderId {
  if (KNOWN.has(raw)) return raw as ProviderId;
  return "other";
}

const PROVIDER_HOME: Record<string, string> = {
  uber: "https://m.uber.com/",
  lyft: "https://www.lyft.com/",
  empower: "https://www.rideempower.com/",
  curb: "https://gocurb.com/",
};

function formatBand(q: {
  priceMinMinor: number;
  priceMaxMinor: number;
  currency?: string;
}): string {
  const lo = q.priceMinMinor / 100;
  const hi = q.priceMaxMinor / 100;
  return lo === hi ? `$${lo.toFixed(2)}` : `$${lo.toFixed(2)}–$${hi.toFixed(2)}`;
}

function BookInner() {
  const params = useSearchParams();
  const providerRaw = (params.get("provider") || "").toLowerCase();
  const provider = asProvider(providerRaw);
  /*
   * There is no company called Provider.
   *
   * This defaulted the query parameter to the string "provider", so /book with
   * nothing on it rendered the headline "Continue with Provider" above a logo
   * placeholder — reproduced live. A handoff that cannot name where it is
   * handing you off to is not a handoff.
   */
  const named = KNOWN.has(providerRaw);
  const label = named ? providerRaw.charAt(0).toUpperCase() + providerRaw.slice(1) : "";
  /*
   * Addresses arrive by session id, not in the query string.
   *
   * /book used to be linked as ?pickup=14+Prince+St&destination=JFK+Terminal+4,
   * which writes a rider's origin and destination into the access log of every
   * proxy in front of this app and into their browser history. The page needs
   * them to show a confirmation and to offer a copy button, so it fetches them
   * from the session instead — the URL carries only opaque ids.
   */
  const sessionId = params.get("s") || "";
  const quoteId = params.get("q") || "";
  /*
   * Three states, not two.
   *
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ `trip` alone could not tell "still loading" from "this trip is gone",  │
   * │ so a dead session rendered the same screen as a slow one: a live link  │
   * │ to the provider's home page, a price of "—", and a disclaimer telling  │
   * │ the reader to "confirm pickup, destination and the final fare" about a │
   * │ pickup and destination the page never showed them. Reproduced with     │
   * │ /book?provider=uber&s=<dead-id>.                                       │
   * └────────────────────────────────────────────────────────────────────────┘
   *
   * The link still goes out — somebody can book without it — but the page
   * stops implying the trip is attached to it.
   */
  const [trip, setTrip] = useState<{
    pickup: string;
    destination: string;
    price: string;
  } | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/quotes/${encodeURIComponent(sessionId)}`);
        if (!res.ok) {
          if (live) setLost(true);
          return;
        }
        const body = await res.json();
        const s = body.session;
        const q = s?.quotes?.find((x: { id: string }) => x.id === quoteId) ?? s?.quotes?.[0];
        if (!live) return;
        setTrip({
          pickup: s?.pickup?.formattedAddress ?? "",
          destination: s?.destination?.formattedAddress ?? "",
          price: q ? formatBand(q) : "—",
        });
      } catch {
        /* The handoff still works without the detail — but it says so. */
        if (live) setLost(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [sessionId, quoteId]);

  const price = trip?.price ?? "—";
  const pickup = trip?.pickup ?? "";
  const destination = trip?.destination ?? "";
  const rawUrl = params.get("url") || PROVIDER_HOME[providerRaw] || "";
  const urlOk = rawUrl ? isAllowedBookingUrl(rawUrl) : false;
  /*
   * Back through history rather than a returnTo parameter. That parameter
   * held the whole deep link, addresses included, so taking them out of the
   * top level of this URL had only moved them.
   */
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else window.location.assign("/");
  };
  const needsManualTrip =
    params.get("prefills") === "0" || providerRaw === "empower" || providerRaw === "curb";
  const [copied, setCopied] = useState(false);

  const copyAddresses = async () => {
    const lines = [
      pickup ? `Pickup: ${pickup}` : null,
      destination ? `Dropoff: ${destination}` : null,
      `Estimate: ${price}`,
    ]
      .filter(Boolean)
      .join("\n");
    if (!lines) return;
    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (!named) {
    return (
      <div className="shell book-shell">
        <div className="status-brand" aria-hidden>
          <span className="brand-mark" />
        </div>
        <p className="eyebrow">Booking handoff</p>
        <h1 className="brand book-title">Nothing to hand off</h1>
        <p className="banner warn" role="alert">
          This link does not say which app it is for, so there is nowhere to send you. Open a
          comparison and choose an option from it.
        </p>
        <button type="button" className="ghost book-back" onClick={goBack}>
          Back to comparison
        </button>
      </div>
    );
  }

  return (
    <div className="shell book-shell">
      <div className="status-brand" aria-hidden>
        <span className="brand-mark" />
      </div>
      <p className="eyebrow">Booking handoff</p>
      <div className="book-hero">
        <ProviderLogo provider={provider} size={40} priority />
        <h1 className="brand book-title">Continue with {label}</h1>
      </div>

      <dl className="book-meta">
        {pickup ? (
          <div>
            <dt className="muted">Pickup</dt>
            <dd>{pickup}</dd>
          </div>
        ) : null}
        {destination ? (
          <div>
            <dt className="muted">Destination</dt>
            <dd>{destination}</dd>
          </div>
        ) : null}
        <div>
          {/*
            "Observed" is the one word this product may never use about its own
            figure, and it was on the last screen before the rider leaves. The
            string appeared exactly once in src/.
          */}
          <dt className="muted">Modeled estimate</dt>
          <dd className="book-price">{price}</dd>
        </div>
      </dl>

      {needsManualTrip ? (
        <div className="banner warn" role="status">
          <p>
            {label} doesn’t accept deep-linked pins from RideLens. Copy the addresses, then enter
            the trip in the {label} app and confirm the final fare.
          </p>
        </div>
      ) : lost ? (
        <p className="muted book-disclaimer">
          The trip this link was made for is no longer on this server, so {label} will open without
          it. Enter the pickup and destination there, and confirm the fare before you ride.
        </p>
      ) : (
        <p className="muted book-disclaimer">
          You’ll finish the request in the {label} app. Confirm pickup, destination, and the final
          fare before you ride.
        </p>
      )}

      {needsManualTrip && (pickup || destination) ? (
        <button type="button" className="book book-continue" onClick={() => void copyAddresses()}>
          {copied ? "Addresses copied" : "Copy addresses to paste"}
        </button>
      ) : null}

      {urlOk ? (
        <a
          className={`book book-with-logo book-continue${needsManualTrip ? " book-secondary" : ""}`}
          href={rawUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ProviderLogo provider={provider} size={24} />
          {needsManualTrip ? `Open ${label}` : `Continue in ${label}`}
        </a>
      ) : (
        <p className="banner warn" role="alert">
          This booking link isn’t available right now. Open {label} from your phone and enter the
          trip there.
        </p>
      )}

      {!needsManualTrip && (pickup || destination) ? (
        <button type="button" className="ghost" onClick={() => void copyAddresses()}>
          {copied ? "Addresses copied" : "Copy addresses"}
        </button>
      ) : null}

      {/*
        This used to ask "what did you actually pay?" — here, on the way out,
        before the trip had happened. It could not be answered, and the
        calibration corpus held zero records for as long as it was the only
        place the question was asked.

        RideLens notes which option was opened and asks on the way back
        instead, once the trip has had time to finish. Nothing to do here.
      */}
      {trip ? (
        <p className="muted fine book-will-ask">
          RideLens will ask what this came to next time you open it. Answering is what lets it tell
          you whether its estimates are any good.
        </p>
      ) : null}

      <button type="button" className="ghost book-back" onClick={goBack}>
        Back to comparison
      </button>
    </div>
  );
}

function BookFallback() {
  return (
    <div className="shell book-shell" aria-busy="true">
      <div className="status-brand" aria-hidden>
        <span className="brand-mark" />
      </div>
      <p className="eyebrow">Booking handoff</p>
      <p className="muted">Preparing handoff…</p>
    </div>
  );
}

export function BookHandoff() {
  return (
    <Suspense fallback={<BookFallback />}>
      <BookInner />
    </Suspense>
  );
}
