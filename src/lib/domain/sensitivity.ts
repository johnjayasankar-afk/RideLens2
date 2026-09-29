/**
 * How much the estimate moves when the model is wrong about its inputs.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE QUESTION NOTHING HERE ANSWERS                                        │
 * │                                                                          │
 * │ The card prints a band. The band is the engine's uncertainty *given its  │
 * │ inputs* — given that the route is 10.8 miles, that the drive takes 29    │
 * │ minutes, that it is dry, that it is 7pm on a Monday. Every one of those  │
 * │ is itself an estimate, and the band says nothing at all about them.      │
 * │                                                                          │
 * │ So a rider reading "$41.55 to 47.80" reads a precision that is real only │
 * │ inside a set of assumptions nobody showed them. This shows them: it      │
 * │ perturbs each input in turn, re-runs the real engine, and reports what   │
 * │ happened.                                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── Why this is honest and a confidence score would not be ─────────────────
 *
 * Nothing here is invented and nothing is fitted. Every figure is the output
 * of the same `computeProductFare` that produced the price on the card, called
 * with one input changed. It is the model's own partial derivative, which is a
 * thing the model genuinely knows — unlike "87% confident", which it does not.
 *
 * It also cannot be read as a forecast. "If the drive runs 25% longer" is a
 * conditional, and the sentence stays a conditional all the way to the screen.
 *
 * ── The finding that matters most ──────────────────────────────────────────
 *
 * Not the swing on any one fare: whether the *ordering* survives. A rider is
 * choosing, not pricing, and an ordering that flips under a plausible traffic
 * assumption is an ordering that was never worth acting on. That is what
 * `ranking` reports, and it is the reason every option is run under every
 * scenario rather than only the cheapest one.
 */

import {
  computeProductFare,
  type FareProduct,
  type LatLng,
} from "@/lib/sources/ratecard/fare-engine";

export interface SensitivitySubject {
  /** The quote this stands for, so the caller can match results back. */
  id: string;
  /** "Curb Taxi" — what the rider is looking at. */
  label: string;
  provider: "uber" | "lyft" | "empower" | "curb";
  product: FareProduct;
  pickup: LatLng;
  destination: LatLng;
  miles: number;
  osrmMinutes: number;
  routeCoordinates?: [number, number][];
  weatherSurgeLift?: number;
  /**
   * The band this option printed on its card.
   *
   * Carried per subject rather than passed once, so the report can take the
   * band belonging to whichever option turns out to be cheapest instead of
   * being handed a guess about which that will be.
   */
  bandLowDollars: number;
  bandHighDollars: number;
}

/** One side of a lever: the input moved one way, and where the fare went. */
export interface LeverArm {
  /** "25% longer" — the change, not the outcome. */
  label: string;
  /** The modeled centre under this scenario. */
  dollars: number;
  /** Signed against the baseline centre. */
  deltaDollars: number;
}

export interface Lever {
  id: LeverId;
  /** "Traffic" */
  label: string;
  /** One sentence on what is being assumed, and what it moves. */
  explain: string;
  down: LeverArm;
  up: LeverArm;
  /** The larger of the two absolute moves. Levers sort by this. */
  swingDollars: number;
}

export interface SensitivityReport {
  /** Which option the arms belong to — the cheapest at baseline. */
  subject: string;
  baselineDollars: number;
  /** The band on the card, for the comparison the whole panel is about. */
  bandLowDollars: number;
  bandHighDollars: number;
  /** Widest first. */
  levers: Lever[];
  /** Across every scenario and the baseline band, the lowest and highest. */
  envelopeLowDollars: number;
  envelopeHighDollars: number;
  /**
   * Whether every scenario landed inside the band already on the card.
   *
   * The more interesting outcome is usually the other one, but this happens —
   * a taxi meter on a fast route barely moves under any of these — and it is
   * the most reassuring thing the panel can report. It has to be able to.
   */
  insideBand: boolean;
  ranking: {
    /** True when the cheapest option is cheapest under every scenario run. */
    stable: boolean;
    /** How many scenarios were run, so "stable" has a denominator. */
    tested: number;
    /** The ones that changed who wins, in words. Empty when stable. */
    upsets: string[];
    /**
     * Whether there was an order to hold in the first place.
     *
     * `stable` is true with one option on the board, because nothing can
     * overturn an ordering of one — which made "Order holds 8/8" the app's
     * most confident claim in the case with the least behind it.
     */
    comparable: boolean;
  };
  headline: string;
}

export type LeverId = "traffic" | "route" | "weather" | "hour";

type Perturbation = {
  leverId: LeverId;
  /** "25% longer" */
  arm: "down" | "up";
  label: string;
  /** Applied to every subject identically, so the comparison stays fair. */
  apply: (s: SensitivitySubject, now: Date) => { input: SensitivitySubject; now: Date };
};

/**
 * How wrong each input plausibly is.
 *
 * These are ranges, not error bars — nothing has measured them, and
 * `docs/CALIBRATION.md` has said since the first commit that the corpus is
 * empty. They are chosen to be the kind of wrong that actually happens: a
 * route that runs long, a driver who takes the other bridge, rain arriving, a
 * trip taken at a different hour than the one the page was loaded at.
 */
const TRAFFIC_LONGER = 1.25;
const TRAFFIC_SHORTER = 0.8;
const ROUTE_LONGER = 1.1;
const ROUTE_SHORTER = 0.92;
/** Open-Meteo's lift at steady rain, per marketplace-dynamics. */
const WET = 1.35;
const PEAK_HOUR = 18;
const QUIET_HOUR = 3;

function at(now: Date, hour: number): Date {
  const d = new Date(now);
  d.setHours(hour, 30, 0, 0);
  return d;
}

const PERTURBATIONS: Perturbation[] = [
  {
    leverId: "traffic",
    arm: "up",
    label: `${Math.round((TRAFFIC_LONGER - 1) * 100)}% longer drive`,
    apply: (s, now) => ({ input: { ...s, osrmMinutes: s.osrmMinutes * TRAFFIC_LONGER }, now }),
  },
  {
    leverId: "traffic",
    arm: "down",
    label: `${Math.round((1 - TRAFFIC_SHORTER) * 100)}% shorter drive`,
    apply: (s, now) => ({ input: { ...s, osrmMinutes: s.osrmMinutes * TRAFFIC_SHORTER }, now }),
  },
  {
    leverId: "route",
    arm: "up",
    label: `${Math.round((ROUTE_LONGER - 1) * 100)}% longer route`,
    apply: (s, now) => ({ input: { ...s, miles: s.miles * ROUTE_LONGER }, now }),
  },
  {
    leverId: "route",
    arm: "down",
    label: `${Math.round((1 - ROUTE_SHORTER) * 100)}% shorter route`,
    apply: (s, now) => ({ input: { ...s, miles: s.miles * ROUTE_SHORTER }, now }),
  },
  {
    leverId: "weather",
    arm: "up",
    label: "steady rain",
    apply: (s, now) => ({ input: { ...s, weatherSurgeLift: WET }, now }),
  },
  {
    leverId: "weather",
    arm: "down",
    label: "dry",
    apply: (s, now) => ({ input: { ...s, weatherSurgeLift: 1 }, now }),
  },
  {
    leverId: "hour",
    arm: "up",
    label: "at the evening peak",
    apply: (s, now) => ({ input: s, now: at(now, PEAK_HOUR) }),
  },
  {
    leverId: "hour",
    arm: "down",
    label: "in the small hours",
    apply: (s, now) => ({ input: s, now: at(now, QUIET_HOUR) }),
  },
];

const LEVER_TEXT: Record<LeverId, { label: string; explain: string }> = {
  traffic: {
    label: "Traffic",
    explain:
      "The drive time the route service returned, moved either way. Every provider here charges " +
      "per minute as well as per mile, so a drive that runs long costs more.",
  },
  route: {
    label: "The route",
    explain:
      "A driver who takes a different way round. Distance moves the per-mile part, and on some " +
      "detours it moves the tolls as well.",
  },
  weather: {
    label: "Weather",
    explain:
      "Rain lifts demand, and demand multiplies the metered part of the fare. This is the " +
      "modeled lift, not a forecast for this trip.",
  },
  hour: {
    label: "The hour",
    explain:
      "The same trip taken at the evening peak or in the small hours. Moves traffic and demand " +
      "together, which is how they move in the world.",
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function centreFor(s: SensitivitySubject, now: Date): number {
  return computeProductFare({
    product: s.product,
    provider: s.provider,
    pickup: s.pickup,
    destination: s.destination,
    miles: s.miles,
    osrmMinutes: s.osrmMinutes,
    routeCoordinates: s.routeCoordinates,
    now,
    weatherSurgeLift: s.weatherSurgeLift,
  }).center;
}

/**
 * Run every option under every scenario.
 *
 * ── `now` is not the current time ──────────────────────────────────────────
 *
 * It is the moment the comparison was priced, and passing anything else
 * quietly breaks the panel. The marketplace ticks about every 55 seconds and
 * carries micro-volatility of a few per cent; re-running at request time gives
 * a baseline from a different tick than the band printed on the card, and the
 * two stop belonging to each other. The first version did exactly that and
 * drew a fare whose baseline sat outside its own band.
 *
 * The engine is deterministic given a clock, so priced at `session.createdAt`
 * the baseline reproduces the centre on the card exactly — which is what makes
 * the strip down the middle of the chart mean anything.
 */
export function buildSensitivity(
  subjects: readonly SensitivitySubject[],
  now: Date,
): SensitivityReport | null {
  if (subjects.length === 0) return null;

  const baselines = new Map<string, number>();
  for (const s of subjects) baselines.set(s.id, centreFor(s, now));

  const cheapest = subjects.reduce((best, s) =>
    baselines.get(s.id)! < baselines.get(best.id)! ? s : best,
  );
  const baseline = baselines.get(cheapest.id)!;
  /* The band belonging to the option the report ended up measuring. */
  const band = { lowDollars: cheapest.bandLowDollars, highDollars: cheapest.bandHighDollars };

  const arms = new Map<string, LeverArm>();
  const upsets: string[] = [];

  for (const p of PERTURBATIONS) {
    /*
     * Every option under the same scenario, because the ordering is the
     * finding. Running only the cheapest would answer "how much does this one
     * move" and leave "does it still win" unanswered — which is the question.
     */
    let winner = cheapest;
    let winnerDollars = Infinity;
    let subjectDollars = baseline;
    for (const s of subjects) {
      const { input, now: when } = p.apply(s, now);
      const dollars = centreFor(input, when);
      if (s.id === cheapest.id) subjectDollars = dollars;
      if (dollars < winnerDollars) {
        winnerDollars = dollars;
        winner = s;
      }
    }

    arms.set(`${p.leverId}:${p.arm}`, {
      label: p.label,
      dollars: round2(subjectDollars),
      deltaDollars: round2(subjectDollars - baseline),
    });

    if (winner.id !== cheapest.id) {
      upsets.push(`${p.label}: ${winner.label} becomes the cheapest, not ${cheapest.label}`);
    }
  }

  const levers: Lever[] = (Object.keys(LEVER_TEXT) as LeverId[])
    .map((id) => {
      const down = arms.get(`${id}:down`)!;
      const up = arms.get(`${id}:up`)!;
      return {
        id,
        label: LEVER_TEXT[id].label,
        explain: LEVER_TEXT[id].explain,
        down,
        up,
        swingDollars: round2(Math.max(Math.abs(down.deltaDollars), Math.abs(up.deltaDollars))),
      };
    })
    .sort((a, b) => b.swingDollars - a.swingDollars);

  const reached = levers.flatMap((l) => [l.down.dollars, l.up.dollars]);
  const envelopeLowDollars = round2(Math.min(band.lowDollars, ...reached));
  const envelopeHighDollars = round2(Math.max(band.highDollars, ...reached));
  const insideBand =
    Math.min(...reached) >= band.lowDollars - 0.005 &&
    Math.max(...reached) <= band.highDollars + 0.005;

  return {
    subject: cheapest.label,
    baselineDollars: round2(baseline),
    bandLowDollars: round2(band.lowDollars),
    bandHighDollars: round2(band.highDollars),
    levers,
    envelopeLowDollars,
    envelopeHighDollars,
    insideBand,
    ranking: {
      stable: upsets.length === 0,
      tested: PERTURBATIONS.length,
      upsets,
      comparable: subjects.length >= 2,
    },
    headline: headlineFor(
      levers,
      cheapest.label,
      upsets.length,
      PERTURBATIONS.length,
      insideBand,
      subjects.length,
    ),
  };
}

function headlineFor(
  levers: readonly Lever[],
  subject: string,
  upsets: number,
  tested: number,
  insideBand: boolean,
  optionCount: number,
): string {
  const top = levers[0];
  /*
   * A model that barely moves under any of these is reporting something real
   * about itself, and saying "the biggest lever is $0.10" would bury it.
   */
  if (!top || top.swingDollars < 0.5) {
    return `Nothing tested here moves ${subject} by more than fifty cents. The estimate rests on the tariff, not on the conditions.`;
  }
  /*
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ With one option on the board this said "Curb Taxi stays the cheapest │
   * │ under all 8. The choice is not resting on an assumption" — a         │
   * │ robustness claim about an ordering that does not exist. It is        │
   * │ vacuously true and reads as reassurance, and the same route with the │
   * │ filter cleared said "3 of 8 scenarios change who wins". One tap      │
   * │ moved the app between two opposite claims, and the more confident of │
   * │ them was the one with less behind it.                                │
   * └──────────────────────────────────────────────────────────────────────┘
   *
   * Nothing being able to overturn an order of one is not evidence. What the
   * scenarios do still say about a single option is how far its own fare
   * moves, which is the rest of this sentence and is real.
   */
  const order =
    optionCount < 2
      ? "There is only one option on the board, so there is no ordering to overturn."
      : upsets === 0
        ? `${subject} stays the cheapest under all ${tested}.`
        : `${upsets} of ${tested} scenarios change which option is cheapest.`;
  const reach = insideBand
    ? "which the band on the card already covers"
    : "further than the band on the card goes";
  const what = top.label.replace(/^The /, "");
  return `${what.charAt(0).toUpperCase()}${what.slice(1).toLowerCase()} moves this fare most — up to $${top.swingDollars.toFixed(2)}, ${reach}. ${order}`;
}
