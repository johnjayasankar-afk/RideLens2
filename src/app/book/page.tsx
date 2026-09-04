"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProviderLogo } from "@/components/provider-logo";
import { isAllowedBookingUrl } from "@/lib/booking/allowed-hosts";
import type { ProviderId } from "@/lib/domain/types";

const KNOWN = new Set(["uber", "lyft", "empower", "curb"]);

function asProvider(raw: string): ProviderId {
  if (KNOWN.has(raw)) return raw as ProviderId;
  return "other";
}

function BookInner() {
  const params = useSearchParams();
  const providerRaw = (params.get("provider") || "provider").toLowerCase();
  const provider = asProvider(providerRaw);
  const label = providerRaw.charAt(0).toUpperCase() + providerRaw.slice(1);
  const price = params.get("price") || "—";
  const pickup = params.get("pickup") || "";
  const destination = params.get("destination") || "";
  const rawUrl = params.get("url") || "";
  const urlOk = rawUrl ? isAllowedBookingUrl(rawUrl) : false;

  return (
    <div className="shell book-shell">
      <p className="eyebrow">Booking handoff</p>
      <div className="book-hero">
        <ProviderLogo provider={provider} size={40} />
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
          <dt className="muted">Observed estimate</dt>
          <dd className="book-price">{price}</dd>
        </div>
      </dl>

      <p className="muted book-disclaimer">
        You’ll finish the request in the {label} app. Confirm pickup,
        destination, and the final fare before you ride.
      </p>

      {urlOk ? (
        <a
          className="book book-with-logo book-continue"
          href={rawUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ProviderLogo provider={provider} size={24} />
          Open {label}
        </a>
      ) : (
        <p className="banner warn" role="alert">
          This booking link isn’t available right now. Open {label} from your
          phone and enter the trip there.
        </p>
      )}
      <a className="ghost book-back" href="/">
        Back to comparison
      </a>
    </div>
  );
}

function BookFallback() {
  return (
    <div className="shell book-shell" aria-busy="true">
      <p className="eyebrow">Booking handoff</p>
      <p className="muted">Preparing handoff…</p>
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={<BookFallback />}>
      <BookInner />
    </Suspense>
  );
}
