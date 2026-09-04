"use client";

import { Suspense, useState } from "react";
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

function safeReturnTo(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function BookInner() {
  const params = useSearchParams();
  const providerRaw = (params.get("provider") || "provider").toLowerCase();
  const provider = asProvider(providerRaw);
  const label = providerRaw.charAt(0).toUpperCase() + providerRaw.slice(1);
  const price = params.get("price") || "—";
  const pickup = params.get("pickup") || "";
  const destination = params.get("destination") || "";
  const rawUrl = params.get("url") || PROVIDER_HOME[providerRaw] || "";
  const urlOk = rawUrl ? isAllowedBookingUrl(rawUrl) : false;
  const backHref = safeReturnTo(params.get("returnTo"));
  const needsManualTrip =
    params.get("prefills") === "0" ||
    providerRaw === "empower" ||
    providerRaw === "curb";
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
          <dt className="muted">Observed estimate</dt>
          <dd className="book-price">{price}</dd>
        </div>
      </dl>

      {needsManualTrip ? (
        <div className="banner warn" role="status">
          <p>
            {label} doesn’t accept deep-linked pins from RideLens. Copy the
            addresses, then enter the trip in the {label} app and confirm the
            final fare.
          </p>
        </div>
      ) : (
        <p className="muted book-disclaimer">
          You’ll finish the request in the {label} app. Confirm pickup,
          destination, and the final fare before you ride.
        </p>
      )}

      {needsManualTrip && (pickup || destination) ? (
        <button
          type="button"
          className="book book-continue"
          onClick={() => void copyAddresses()}
        >
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
          This booking link isn’t available right now. Open {label} from your
          phone and enter the trip there.
        </p>
      )}

      {!needsManualTrip && (pickup || destination) ? (
        <button
          type="button"
          className="ghost"
          onClick={() => void copyAddresses()}
        >
          {copied ? "Addresses copied" : "Copy addresses"}
        </button>
      ) : null}

      <a className="ghost book-back" href={backHref}>
        Back to comparison
      </a>
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

export default function BookPage() {
  return (
    <Suspense fallback={<BookFallback />}>
      <BookInner />
    </Suspense>
  );
}
