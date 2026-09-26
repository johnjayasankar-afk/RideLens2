/**
 * Walk two blocks, pay less.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ hotspots.ts exists because standing outside Penn Station at 6pm costs    │
 * │ more than standing a few hundred metres away, and the model already      │
 * │ knows it. Nothing surfaced that. The price was simply higher and the     │
 * │ rider was never told they could do anything about it.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── What keeps this honest ─────────────────────────────────────────────────
 *
 * The comparison is between two points of the *same model*, at the same
 * instant, for the same trip and provider. Everything except the hotspot
 * heat is identical, so the model's own level error is shared and cancels:
 * if the engine reads 8% high here, it reads 8% high two blocks away.
 *
 * Demanding that the two bands clear each other — the rule for comparing two
 * different providers' quotes — was therefore the wrong test, and the same
 * mistake already made and fixed in departure-window.ts. It made this fire
 * almost never: a hotspot lift of 5% against bands of 3% leaves nothing.
 *
 * What does not cancel is error in the heat map itself, which is a guess
 * about where demand concentrates. DIFFERENTIAL_TOLERANCE covers that, the
 * quoted saving is net of it, and the floor below keeps small differences
 * from becoming advice.
 *
 * The walk time is measured by a routing engine, not inferred from distance.
 * A straight line across a rail yard is four hundred metres and not a walk.
 * If the router cannot answer, no suggestion is made.
 *
 * And it only ever points *out* of a hotspot. Moving between two busy
 * corners is not advice.
 */

import { hotspotHeat } from "@/lib/sources/ratecard/hotspots";

export interface Point {
  lat: number;
  lng: number;
}

export interface WalkCandidate extends Point {
  /** Degrees clockwise from north, for the "head north-east" phrasing. */
  bearingDeg: number;
  /** Straight-line metres from the original pickup. */
  offsetMeters: number;
  /** Modeled demand heat here, for comparison with the origin. */
  heat: number;
}

/** How far a rider will plausibly walk to save a few dollars. */
export const WALK_RINGS_METERS = [220, 400] as const;
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

export function compassName(bearingDeg: number): string {
  const i = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i]!;
}

/** Offset a point by metres along a bearing. Flat-earth is fine at this scale. */
export function offsetPoint(from: Point, bearingDeg: number, meters: number): Point {
  const rad = (bearingDeg * Math.PI) / 180;
  const dNorth = Math.cos(rad) * meters;
  const dEast = Math.sin(rad) * meters;
  const dLat = dNorth / 111_320;
  const dLng = dEast / (111_320 * Math.cos((from.lat * Math.PI) / 180));
  return { lat: from.lat + dLat, lng: from.lng + dLng };
}

/**
 * Points worth pricing, coolest first.
 *
 * Only places materially cooler than where the rider is standing. Somewhere
 * equally busy is not somewhere to walk to, and pricing it wastes the
 * request.
 */
export function coolerCandidates(pickup: Point, now: Date, minHeatDrop = 0.02): WalkCandidate[] {
  const here = hotspotHeat(pickup, now);
  if (here.heat <= 0) return [];

  const out: WalkCandidate[] = [];
  for (const meters of WALK_RINGS_METERS) {
    for (const bearingDeg of BEARINGS) {
      const at = offsetPoint(pickup, bearingDeg, meters);
      const { heat } = hotspotHeat(at, now);
      if (here.heat - heat < minHeatDrop) continue;
      out.push({ ...at, bearingDeg, offsetMeters: meters, heat });
    }
  }
  return out.sort((a, b) => a.heat - b.heat);
}

export interface PricedCandidate extends WalkCandidate {
  lowMinor: number;
  highMinor: number;
  /** Measured, never inferred from distance. Null means no suggestion. */
  walkSeconds: number | null;
}

export interface WalkSuggestion {
  candidate: PricedCandidate;
  /** The part of the saving that clears both bands. */
  savingMinor: number;
  walkSeconds: number;
  sentence: string;
}

/** Above this, it stops being "two blocks". */
export const MAX_WALK_SECONDS = 9 * 60;
/** Below this, the walk is not worth the sentence. */
export const MIN_SAVING_MINOR = 150;
/**
 * The part of the model's error that does *not* cancel between two points
 * a few hundred metres apart, as a share of the fare.
 *
 * A prior, like everything else in the demand model. Deliberately not zero:
 * the heat map is a guess about where demand concentrates, and two points
 * either side of an imaginary boundary are not as different as it claims.
 */
export const DIFFERENTIAL_TOLERANCE = 0.015;

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

/**
 * The best walk worth suggesting, or nothing.
 *
 * Centres are compared, not band edges, because the bands overlap by
 * construction — see the header. The tolerance is subtracted from the
 * saving before it is quoted, so "at least $X" stays true even if the heat
 * map is wrong by its whole allowance.
 */
export function chooseWalk(
  hereLowMinor: number,
  hereHighMinor: number,
  candidates: readonly PricedCandidate[],
): WalkSuggestion | null {
  let best: WalkSuggestion | null = null;
  const hereCentre = (hereLowMinor + hereHighMinor) / 2;
  const tolerance = Math.round(hereCentre * DIFFERENTIAL_TOLERANCE);

  for (const c of candidates) {
    if (c.walkSeconds == null) continue;
    if (c.walkSeconds > MAX_WALK_SECONDS) continue;

    const centre = (c.lowMinor + c.highMinor) / 2;
    const saving = Math.round(hereCentre - centre) - tolerance;
    if (saving < MIN_SAVING_MINOR) continue;
    if (best && saving <= best.savingMinor) continue;

    const mins = Math.max(1, Math.round(c.walkSeconds / 60));
    best = {
      candidate: c,
      savingMinor: saving,
      walkSeconds: c.walkSeconds,
      sentence: `Walking ${mins} min ${compassName(c.bearingDeg)} is modeled at least ${money(saving)} cheaper — you would be outside a busy pickup zone.`,
    };
  }

  return best;
}
