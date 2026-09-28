/**
 * Everything the assistant is allowed to know.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A language model inside this product is a liability before it is a       │
 * │ feature. Every other honesty measure here — the provenance chip, the     │
 * │ widened bands, the refusal to name a winner on overlapping bands, the    │
 * │ corpus that withholds a statistic below twenty samples — exists to stop  │
 * │ the product saying something it cannot support. One confidently invented │
 * │ fare undoes all of it.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the assistant is not given a topic, it is given a *brief*: the figures
 * actually on the reader's screen, the fee stack that produced them, and an
 * explicit list of what is not known. The system prompt then forbids stating
 * any figure that is not in the brief.
 *
 * That constraint is only as good as the brief is complete, which is why this
 * file is pure and tested: it is the whole of the model's world.
 *
 * ── Why the numbers are pre-formatted ──────────────────────────────────────
 *
 * Every money figure arrives as the string the rider is already looking at —
 * "$69.95 to $71.45", not `{min: 6995, max: 7145}`. A model handed minor
 * units will eventually divide by a hundred in prose and call it a price, and
 * a model handed a band will eventually average it. Neither can happen to a
 * string it is told to quote verbatim.
 */

import { confidenceLabel } from "@/lib/domain/confidence";
import { formatMoneyMinor, formatQuotePrice } from "@/lib/domain/money";
import { provenanceOf } from "@/lib/domain/provenance";
import { rankQuotes } from "@/lib/domain/ranking";
import { historyForRoute, routeKeyFor, type TripRecord } from "@/lib/history/trip-log";
import { personalAccuracy } from "@/lib/history/outcome";
import type { NormalizedQuote, QuoteSession } from "@/lib/domain/types";

/** One option, as the reader sees it. */
export interface BriefOption {
  provider: string;
  product: string;
  price: string;
  kind: string;
  confidence: string;
  pickupWait: string | null;
  arrivesIn: string | null;
  basis: string;
  /** Named charges that make up this fare, already in dollars. */
  charges: Array<{ name: string; amount: string }>;
}

export interface AssistantBrief {
  route: { from: string; to: string; miles: string | null; drive: string | null };
  takenAt: string;
  options: BriefOption[];
  /** The marketplace state these prices were produced under. */
  market: { demand: string; weather: string | null; modelVersion: string };
  /** The rider's own record, when there is enough of it to mention. */
  yourHistory: string | null;
  /** Said out loud, so the model has it rather than inferring it. */
  limits: string[];
}

function minutes(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const m = Math.round(seconds / 60);
  return m <= 1 ? "about a minute" : `about ${m} minutes`;
}

/** Turn a fee-breakdown key into something a person would recognise. */
function chargeName(key: string): string {
  const named: Record<string, string> = {
    nys_congestion_below_96: "New York State congestion surcharge",
    nys_congestion_taxi: "New York State congestion surcharge (taxi rate)",
    mta_congestion_below_60: "MTA congestion relief zone charge",
    mta_congestion_taxi: "MTA congestion relief zone charge (taxi rate)",
    mta_state_surcharge: "MTA state surcharge",
    taxi_improvement: "taxi improvement surcharge",
    port_authority: "airport access fee",
    black_car_fund: "Black Car Fund",
    ny_sales_tax: "New York sales tax",
    tnc_assessment: "state TNC assessment",
    nyc_jfk_flat: "JFK flat fare",
    marketplace_rules: "time-of-day surcharge",
    marketplace_additive: "time-of-day surcharge",
    tlc_driver_minimum: "regulated driver-pay minimum",
    non_nyc_crz_fund: "congestion zone fund",
  };
  if (named[key]) return named[key];
  if (key.startsWith("toll_")) return `toll (${key.slice(5).replace(/_/g, " ")})`;
  return key.replace(/_/g, " ");
}

/**
 * Charges worth naming.
 *
 * Multipliers and weights are filtered out: `directional_asymmetry: 1.08` is a
 * ratio, and a model shown a bare 1.08 beside a list of dollar amounts will
 * eventually describe it as $1.08.
 */
function chargesOf(quote: NormalizedQuote): Array<{ name: string; amount: string }> {
  const breakdown = quote.metadata?.feeBreakdown;
  if (!breakdown || typeof breakdown !== "object") return [];
  const out: Array<{ name: string; amount: string }> = [];
  for (const [key, value] of Object.entries(breakdown as Record<string, unknown>)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value === 0) continue;
    if (key.endsWith("_factor") || key === "directional_asymmetry") continue;
    out.push({ name: chargeName(key), amount: formatMoneyMinor(Math.round(value * 100)) });
  }
  return out;
}

/**
 * Build the brief.
 *
 * `records` is the rider's own trip log, passed in from the client — the
 * server has never seen it and does not keep it.
 */
export function buildBrief(
  session: QuoteSession,
  records: readonly TripRecord[] = [],
  modelVersion = "",
): AssistantBrief {
  const ranked = rankQuotes(session.quotes, session.rankingMode, "ALL");
  const withRoute = ranked.find((q) => q.distanceMeters != null);
  const withDrive = ranked.find((q) => q.tripDurationSeconds != null);

  const options: BriefOption[] = ranked.map((q) => ({
    provider: q.provider,
    product: q.providerProductName,
    price: formatQuotePrice(q),
    kind: q.priceType === "UPFRONT_QUOTE" ? "held upfront quote" : "modeled estimate",
    confidence: confidenceLabel(q.confidenceClass),
    pickupWait: minutes(q.pickupEtaSeconds),
    arrivesIn: minutes(q.tripDurationSeconds),
    basis: provenanceOf(q).label,
    charges: chargesOf(q),
  }));

  const hero = ranked[0];
  const demand = hero?.metadata?.demandCenter;
  const weather = hero?.metadata?.weather;

  const from = session.pickup.name || session.pickup.formattedAddress.split(",")[0] || "pickup";
  const to =
    session.destination.name || session.destination.formattedAddress.split(",")[0] || "destination";

  /* The rider's own record, but only where it is allowed to be spoken of. */
  const routeKey = routeKeyFor(
    { lat: session.pickup.lat, lng: session.pickup.lng, label: "" },
    { lat: session.destination.lat, lng: session.destination.lng, label: "" },
  );
  const history = historyForRoute(
    records.filter((r) => r.id !== session.id),
    routeKey,
    modelVersion,
  );
  const accuracy = personalAccuracy(records);

  const yourHistory = history
    ? `Across ${history.n} earlier comparisons of this exact route, the cheapest option ran ` +
      `${formatMoneyMinor(history.cheapestLowMinor)} to ${formatMoneyMinor(history.cheapestHighMinor)}. ` +
      (accuracy.summary
        ? `Across ${accuracy.n} trips this rider reported a fare for, the band contained it ` +
          `${Math.round(accuracy.summary.coverage * 100)}% of the time.`
        : `This rider has reported an actual fare ${accuracy.n} times, which is too few to say how accurate the estimates have been.`)
    : null;

  return {
    route: {
      from,
      to,
      miles:
        withRoute?.distanceMeters != null
          ? `${(withRoute.distanceMeters / 1609.344).toFixed(1)} miles`
          : null,
      drive: minutes(withDrive?.tripDurationSeconds ?? null),
    },
    takenAt: session.createdAt,
    options,
    market: {
      demand:
        typeof demand === "number"
          ? demand >= 1.15
            ? `busy — modeled at ${demand.toFixed(2)}x`
            : `steady — modeled at ${demand.toFixed(2)}x`
          : "not known",
      weather: typeof weather === "string" && weather ? weather : null,
      modelVersion: modelVersion || "unknown",
    },
    yourHistory,
    limits: [
      "These are modeled estimates, not live quotes from the providers. RideLens has no partner API switched on.",
      "The model has never been measured against a real fare — the calibration corpus is empty.",
      "The final fare is whatever the provider charges at booking, and may differ.",
      "Promotions, subscriptions and account credits are invisible to RideLens.",
      "Tips are not included in any figure here.",
    ],
  };
}

/**
 * The brief as the model sees it.
 *
 * Plain text rather than JSON: a model handed JSON tends to answer in JSON,
 * and this is a conversation. The figures stay verbatim either way.
 */
export function renderBrief(brief: AssistantBrief): string {
  const lines: string[] = [];
  lines.push(`ROUTE: ${brief.route.from} to ${brief.route.to}`);
  if (brief.route.miles) lines.push(`DISTANCE: ${brief.route.miles}`);
  if (brief.route.drive) lines.push(`DRIVE TIME: ${brief.route.drive}`);
  lines.push(`COMPARED AT: ${brief.takenAt}`);
  lines.push(`MARKET: demand ${brief.market.demand}`);
  if (brief.market.weather) lines.push(`WEATHER: ${brief.market.weather}`);
  lines.push(`MODEL VERSION: ${brief.market.modelVersion}`);
  lines.push("");
  lines.push("OPTIONS (in the order shown to the rider):");
  for (const o of brief.options) {
    lines.push(`- ${o.provider} ${o.product}: ${o.price} (${o.kind}, confidence ${o.confidence})`);
    if (o.pickupWait) lines.push(`    pickup wait: ${o.pickupWait}`);
    if (o.arrivesIn) lines.push(`    drive: ${o.arrivesIn}`);
    lines.push(`    basis: ${o.basis}`);
    if (o.charges.length > 0) {
      lines.push(
        `    charges included: ${o.charges.map((c) => `${c.name} ${c.amount}`).join(", ")}`,
      );
    }
  }
  if (brief.yourHistory) {
    lines.push("");
    lines.push(`THIS RIDER'S OWN RECORD: ${brief.yourHistory}`);
  }
  lines.push("");
  lines.push("WHAT IS NOT KNOWN:");
  for (const limit of brief.limits) lines.push(`- ${limit}`);
  return lines.join("\n");
}

/**
 * The rules, and they are the feature.
 *
 * Written as prohibitions rather than aspirations because the failure mode is
 * specific: a helpful-sounding sentence containing a number nobody computed.
 */
export const ASSISTANT_SYSTEM_PROMPT = `You are the assistant inside RideLens, a rideshare price comparison.

You are given a BRIEF containing the figures currently on the rider's screen. It is the whole of what you know about this trip.

HARD RULES — these outrank being helpful:

1. Never state a price, fare, duration, distance, percentage or fee amount that does not appear in the BRIEF. Quote figures from it verbatim, including the dollar signs and the word "to" in a range.
2. Never average a range, never take a midpoint, never say "about $70" for a band of $69.95 to $71.45. The range is the answer. RideLens deliberately never shows a midpoint because it is a number nobody was ever quoted.
3. Never say which option is cheaper when two ranges overlap. Say the ranges overlap and that the comparison does not separate them.
4. Never describe these as live quotes, real-time prices, or what the rider will be charged. They are modeled estimates. If asked what they will actually pay, say that the provider decides that at booking.
5. If the BRIEF does not contain what is needed to answer, say so plainly and stop. Do not reason toward a number. "I don't have that" is a complete and correct answer.
6. Never give investment, legal or safety advice, and never claim a provider is licensed, safe or insured.

STYLE: brief and plain. Two or three sentences for most questions. No bullet lists unless comparing three or more things. No preamble — answer the question first. Write like a knowledgeable person explaining a receipt, not like a chatbot.

You can also act on the rider's behalf using the tools you have been given. Use a tool when the rider asks for something to happen — re-run the comparison, swap the route, watch the price, change the ranking. Say in one short sentence what you did. If they only asked a question, do not call a tool.`;
