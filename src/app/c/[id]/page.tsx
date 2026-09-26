/**
 * A comparison, as it looked at the time.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Sharing the deep link shares the *route*, and whoever opens it gets      │
 * │ today's prices. That is a different artifact: "here is what a trip to    │
 * │ JFK costs" rather than "here is what I was looking at when I booked".    │
 * │ Persisted sessions make the second one possible, and it is the honest    │
 * │ one — the numbers on it are the numbers somebody actually saw.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Which makes the framing the whole job. Every price here is historical and
 * the page says so before it says anything else: the time it was taken, how
 * long ago that was, and a way to run it again now. A snapshot that reads
 * like a live quote would be the worst thing this product has ever shipped.
 *
 * A Server Component — no client bundle at all beyond the shell. There is
 * nothing interactive on it, and nothing to hydrate.
 */

import type { Metadata, Route } from "next";
import Link from "next/link";
import { ProviderLogo } from "@/components/provider-logo";
import { formatQuotePrice } from "@/lib/domain/money";
import { provenanceOf } from "@/lib/domain/provenance";
import { rankQuotes } from "@/lib/domain/ranking";
import { getSession } from "@/lib/quotes/orchestrator";
import { sessionsAreDurable } from "@/lib/quotes/session-store";
import type { NormalizedQuote } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

function ageLabel(iso: string, now = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "less than a minute ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function takenAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return { title: "Comparison not found · RideLens" };

  const from = session.pickup.formattedAddress.split(",")[0];
  const to = session.destination.formattedAddress.split(",")[0];
  return {
    title: `${from} → ${to} · RideLens`,
    description: `What Uber, Lyft, Empower and Curb were modeled at for this trip on ${takenAt(session.createdAt)}.`,
    /* Kept out of search results: these are snapshots, not pages. */
    robots: { index: false, follow: false },
  };
}

/**
 * A link that does not resolve, explained rather than 404'd.
 *
 * There are two quite different reasons this happens and conflating them
 * wastes somebody's time. A link can be genuinely old — comparisons age out.
 * Or the deployment can have no database, in which case sessions live only
 * in one process's memory and a shared link was never going to survive the
 * trip. The second is a configuration fact, not the reader's fault, and
 * saying "not found" to it is a small lie.
 */
function MissingComparison() {
  const durable = sessionsAreDurable();
  return (
    <div className="shell snapshot">
      <h1 className="snapshot-route">This comparison is not here</h1>
      <p className="snapshot-foot muted">
        {durable
          ? "Shared comparisons are kept for a while and then let go. This one has aged out, or the link is wrong."
          : "This deployment has no database attached, so comparisons live only in the memory of the process that made them and a shared link cannot outlive it. Nothing is wrong with the link."}
      </p>
      <div className="snapshot-actions">
        <Link href="/" className="primary snapshot-cta">
          Run a comparison
        </Link>
      </div>
    </div>
  );
}

export default async function SharedComparison({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return <MissingComparison />;

  const ranked = rankQuotes(session.quotes, session.rankingMode, "ALL");
  const from = session.pickup.formattedAddress.split(",")[0];
  const to = session.destination.formattedAddress.split(",")[0];
  const live = `/?from=${session.pickup.lat},${session.pickup.lng},${encodeURIComponent(from)}&to=${session.destination.lat},${session.destination.lng},${encodeURIComponent(to)}`;

  return (
    <div className="shell snapshot">
      {/*
        Before anything else. Somebody arriving from a message has no idea
        these numbers are old unless the page tells them first.
      */}
      <p className="snapshot-stamp">
        <span className="snapshot-dot" aria-hidden />
        Taken {takenAt(session.createdAt)} — {ageLabel(session.createdAt)}. These are the prices as
        they were modeled then, not now.
      </p>

      <h1 className="snapshot-route">
        {from} <span aria-hidden>→</span> {to}
      </h1>

      <ol className="snapshot-list">
        {ranked.map((q: NormalizedQuote, i) => (
          <li className="snapshot-row" key={q.id} data-best={i === 0 ? "true" : undefined}>
            <ProviderLogo provider={q.provider} size={32} />
            <span className="snapshot-name">
              <strong>{q.providerProductName}</strong>
              <span className="muted">{provenanceOf(q).label}</span>
            </span>
            <span className="snapshot-price">{formatQuotePrice(q)}</span>
          </li>
        ))}
      </ol>

      {ranked.length === 0 ? (
        <p className="muted">This comparison came back with no available options.</p>
      ) : null}

      <div className="snapshot-actions">
        {/* typedRoutes cannot check a URL assembled at runtime; the shape is
            the same deep link the compare form produces. */}
        <Link href={live as Route} className="primary snapshot-cta">
          Run this comparison now
        </Link>
        <p className="muted snapshot-foot">
          RideLens compares modeled estimates, not live provider quotes. Whatever these said, the
          fare is whatever the provider charges when you book.
        </p>
      </div>
    </div>
  );
}
