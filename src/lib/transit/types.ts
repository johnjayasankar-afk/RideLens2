/**
 * What else you could do instead of taking a car.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The honest answer for a huge share of the queries this app will get is   │
 * │ "take the train". Midtown to JFK is $73 in a car and $11.75 on the       │
 * │ AirTrain, and a comparison product that hides that is a shopping funnel  │
 * │ wearing a comparison's clothes.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── Why a fare appears and a journey time does not ─────────────────────────
 *
 * Fares are published. They were read off the operators' own pages and carry
 * a source and a date — see tariffs.ts.
 *
 * Journey times are not published as a single number; they come out of a
 * routing engine reading a schedule. There is no schedule source wired up
 * here, and a plausible-looking "about 55 minutes" would be exactly the kind
 * of unsourced figure this codebase has already had to go back and strip out
 * once. So the time is absent and says it is absent, until a
 * `TransitRoutingSource` is configured.
 *
 * That is the same shape as the five dormant rideshare adapters: the seam
 * exists, the contract is defined, and nothing pretends to be live until
 * someone wires it up.
 */

import type { TransitTariff } from "./tariffs";

export interface TransitAlternative {
  id: string;
  /** "AirTrain + subway", "Walk". */
  label: string;
  kind: "transit" | "walk";
  /** Modeled fare in minor units. Zero is a real answer for walking. */
  fareMinor: number;
  /**
   * Journey time, when something actually computed one.
   *
   * Null means nobody has measured it — not that it is instant. Every
   * surface has to render that difference.
   */
  durationSeconds: number | null;
  /** Why the duration is missing, when it is. */
  durationNote: string | null;
  /** A leg that exists and is not priced here. */
  unmodeled: string | null;
  tariff?: TransitTariff;
  /** Where the fare came from, for the provenance sheet. */
  sources: Array<{ label: string; url: string; verifiedOn: string }>;
}

export interface TransitRoutingSource {
  id: string;
  configured(): boolean;
  /**
   * Journey time for a trip, or null when this source cannot answer.
   *
   * Returning null is a first-class result. A source that guesses is worse
   * than one that declines.
   */
  durationSeconds(
    pickup: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    signal?: AbortSignal,
  ): Promise<number | null>;
}
