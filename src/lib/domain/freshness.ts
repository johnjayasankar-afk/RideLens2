import type { Freshness } from "./types";

export const FRESHNESS_THRESHOLDS = {
  liveMs: 30_000,
  recentMs: 120_000,
  staleMs: 300_000,
} as const;

export type FreshnessStatus = "Fresh" | "Recent" | "Aging" | "Expired";

export function computeFreshness(
  receivedAt: string | Date,
  expiresAt: string | Date | null | undefined,
  now: Date = new Date(),
  thresholds = FRESHNESS_THRESHOLDS,
): Freshness {
  const received = typeof receivedAt === "string" ? new Date(receivedAt) : receivedAt;
  const ageMs = now.getTime() - received.getTime();

  if (expiresAt) {
    const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
    if (now.getTime() >= exp.getTime()) return "EXPIRED";
  }

  if (ageMs < 0) return "LIVE";
  if (ageMs <= thresholds.liveMs) return "LIVE";
  if (ageMs <= thresholds.recentMs) return "RECENT";
  if (ageMs <= thresholds.staleMs) return "STALE";
  return "EXPIRED";
}

/** Soft UI label for freshness — never all-caps domain enums. */
export function freshnessStatus(freshness: Freshness): FreshnessStatus {
  switch (freshness) {
    case "LIVE":
      return "Fresh";
    case "RECENT":
      return "Recent";
    case "STALE":
      return "Aging";
    case "EXPIRED":
      return "Expired";
    default:
      return "Aging";
  }
}

export function freshnessLabel(
  freshness: Freshness,
  receivedAt: string,
  now: Date = new Date(),
): string {
  if (freshness === "EXPIRED") return "expired";
  const ageSec = Math.max(0, Math.floor((now.getTime() - new Date(receivedAt).getTime()) / 1000));
  if (ageSec < 5) return "just now";
  if (ageSec < 60) return `${ageSec} sec ago`;
  const mins = Math.floor(ageSec / 60);
  return `${mins} min ago`;
}

export function expiryCountdown(expiresAt: string | null, now: Date = new Date()): string | null {
  if (!expiresAt) return null;
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  if (remaining <= 0) return "Expired";
  const totalSec = Math.floor(remaining / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `Quote expires in ${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * How long ago, at the scale a person remembers things.
 *
 * `freshnessLabel` stops at minutes because a quote that is an hour old is
 * simply expired. A trip you compared last Tuesday is a different scale of
 * question, and the snapshot page had grown its own copy of this to answer
 * it. One helper, used by both.
 *
 * Deliberately coarse. "3 days ago" is what a reader wants; "2 days and 17
 * hours ago" is precision that means nothing to them.
 */
export function coarseAgeLabel(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}
