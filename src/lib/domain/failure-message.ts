/**
 * What to say when a comparison does not come back.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Every other failure in this product has been given a sentence: an        │
 * │ uncovered market names the nearest one it models and how far away it is, │
 * │ a rate limit counts down, a dead tile server says the route stats still  │
 * │ hold. The one that had not been written was the most common one — the    │
 * │ request simply not arriving — and it surfaced the browser's own words.   │
 * │ "Failed to fetch" is not a thing to show a person.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Each message says what happened, whether it is worth trying again, and
 * what is still true — because the previous comparison is usually still on
 * screen and still usable, and nothing was telling anyone that.
 */

export type FailureKind =
  "offline" | "unreachable" | "server" | "timeout" | "rate_limited" | "unknown";

export interface FailureMessage {
  kind: FailureKind;
  /** One line, the headline. */
  title: string;
  /** One line under it. May be empty. */
  detail: string;
  /** Whether a retry button is worth offering. */
  retryable: boolean;
}

/**
 * Classify a thrown error, or an HTTP status, into something sayable.
 *
 * `online` is passed in rather than read from navigator here, so this stays
 * pure and testable — and so the caller can use the value it already has.
 */
export function describeFailure(error: unknown, online: boolean, status?: number): FailureMessage {
  if (!online) {
    return {
      kind: "offline",
      title: "You are offline",
      detail:
        "Anything already on screen is the last comparison that arrived — the prices will have moved since.",
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      kind: "rate_limited",
      title: "Too many comparisons",
      detail: "Give it a moment and try again.",
      retryable: true,
    };
  }

  if (typeof status === "number" && status >= 500) {
    return {
      kind: "server",
      title: "RideLens could not price this trip",
      detail: "The fault is at our end, not yours. Trying again often works.",
      retryable: true,
    };
  }

  const message = error instanceof Error ? error.message : String(error ?? "");

  if (/abort|timeout|timed out/i.test(message)) {
    return {
      kind: "timeout",
      title: "That took too long",
      detail: "The routing or rate-card lookup did not come back in time.",
      retryable: true,
    };
  }

  /*
   * "Failed to fetch" is what a browser says when the request never left, or
   * never came back — a dropped connection, a blocked request, a server that
   * is not there. All the rider needs to know is that nothing arrived.
   */
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return {
      kind: "unreachable",
      title: "Could not reach RideLens",
      detail: "The request did not get through. Check your connection and try again.",
      retryable: true,
    };
  }

  return {
    kind: "unknown",
    title: "The comparison did not finish",
    detail: message && message.length < 120 ? message : "Something went wrong on the way.",
    retryable: true,
  };
}
