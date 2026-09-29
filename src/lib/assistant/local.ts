/**
 * The assistant, without a model behind it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS EXISTS                                                          │
 * │                                                                          │
 * │ `ANTHROPIC_API_KEY` is optional, and on every machine that does not set  │
 * │ it — a fresh clone, CI, a reviewer's laptop, the owner's own build —     │
 * │ `/api/ask` answered 503 and the client rendered no assistant at all.     │
 * │ The feature was not degraded, it was absent, and absent in a way nobody  │
 * │ looking at the page could diagnose.                                      │
 * │                                                                          │
 * │ So the question is what an assistant should do when it cannot reach a    │
 * │ model. The answer this file takes: the hard part of the assistant was    │
 * │ never the language. It was the brief — the discipline of assembling      │
 * │ exactly the figures on the rider's screen, pre-formatted as the strings  │
 * │ they are already reading, so that no figure can be invented downstream.  │
 * │ That work is done, it is pure, and it is tested. A model is one way to   │
 * │ turn a brief into a sentence. It is not the only one.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── The property that makes this safe ──────────────────────────────────────
 *
 * Every figure in every reply is a string lifted verbatim out of the brief.
 * Nothing here parses a price back into a number, and nothing here does
 * arithmetic on money at all. The eight hard rules in ASSISTANT_SYSTEM_PROMPT
 * are prohibitions a model is asked to honour; here the same rules are
 * properties of the code. It cannot average a band, because it never holds
 * one as a number. It cannot name a winner across overlapping bands, because
 * the only sentence it has about ordering is the one `buildBrief` pre-wrote
 * with `comparePrices`.
 *
 * That makes it strictly more honest than the model path, and considerably
 * less fluent. Both of those are worth saying out loud, which is why the
 * reply surface reports which one answered rather than letting the rider
 * assume.
 *
 * ── What it is not ─────────────────────────────────────────────────────────
 *
 * It is not an AI, and the UI must not call it one. It recognises a question
 * it has an answer for, or it says it does not have one — and "I don't have
 * that" was already rule 5 of the model's own brief, because a refusal is a
 * complete and correct answer. The repertoire below is finite on purpose: a
 * matcher that stretches to cover a question it does not really understand
 * is how a helpful-sounding sentence containing a number nobody computed
 * gets written.
 */

import { type AssistantAction } from "./actions";
import type { AssistantBrief, BriefOption } from "./context";

import { PANELS, type PanelId } from "@/lib/domain/panels";

/** A reply: what to say, and optionally one thing to do. */
export interface LocalReply {
  text: string;
  /** Validated by the client before it runs, exactly like the model's. */
  action: AssistantAction | null;
  /** True when nothing in the repertoire matched, so callers can count it. */
  refused: boolean;
}

/**
 * Words are matched against a normalised question.
 *
 * Lowercased, punctuation to spaces, collapsed — so "What's it made of?" and
 * "what is it made of" reach the same string, and a term can be matched with
 * spaces around it without worrying about the ends.
 */
function normalise(question: string): string {
  return ` ${question
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .trim()} `;
}

const has = (q: string, ...terms: string[]): boolean => terms.some((t) => q.includes(` ${t} `));

/** A list of sentences, joined the way a person writes them. */
function sentences(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(" ");
}

/**
 * The options, as a list the rider can read.
 *
 * Every price is the brief's own formatted string. The order is the brief's
 * order, which is the order on screen — so the reply and the page agree even
 * when the rider has re-ranked them.
 */
function listOptions(options: readonly BriefOption[], limit = 4): string {
  return options
    .slice(0, limit)
    .map((o) => `${nameOf(o)} ${o.price}`)
    .join(", ");
}

/**
 * What to call an option.
 *
 * `product` already carries the brand — "Curb Taxi", "UberX", "Lyft" — while
 * `provider` is the lowercase source id. Printing both gives "curb Curb Taxi".
 */
function nameOf(o: BriefOption): string {
  return o.product || o.provider;
}

/** The option a question names, if it names one. */
function optionNamed(q: string, options: readonly BriefOption[]): BriefOption | null {
  for (const o of options) {
    const provider = o.provider.toLowerCase();
    const product = o.product.toLowerCase();
    if (q.includes(` ${provider} `) || (product.length > 2 && q.includes(` ${product} `))) return o;
    /* "uberx" and "uber x" are the same request. */
    if (q.replace(/ /g, "").includes(`${provider}${product}`.replace(/ /g, ""))) return o;
  }
  return null;
}

/**
 * Words that appear in a panel's keywords but carry no intent.
 *
 * The whatif panel's keywords begin "what if", so before this existed every
 * question containing the word "what" — which is most of them — scored a
 * match and opened the sensitivity panel. A matcher that fires on an
 * interrogative is not matching on meaning.
 */
const STOP = new Set([
  "what",
  "if",
  "it",
  "per",
  "each",
  "side",
  "by",
  "where",
  "goes",
  "the",
  "and",
  "a",
  "no",
  "not",
  "one",
  "out",
  "way",
  "time",
  "back",
  "next",
  "hour",
  "money",
  "people",
  "home",
]);

/** The panel a question is really asking to see, if any. */
function panelAsked(q: string): PanelId | null {
  let best: { id: PanelId; score: number } | null = null;
  for (const panel of PANELS) {
    const score = panel.keywords
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP.has(word) && q.includes(` ${word} `)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: panel.id, score };
  }
  return best?.id ?? null;
}

/**
 * A dollar figure the rider typed, for a price watch.
 *
 * The one number this file reads out of the *question* rather than the brief.
 * It is the rider's own threshold, not an estimate of anything, and it goes
 * through the same `actionSchema` the model's tool call does.
 */
function thresholdIn(q: string): number | null {
  const match = / \$?(\d+(?:\.\d{1,2})?) /.exec(q);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 && value <= 1000 ? value : null;
}

/** What this assistant can be asked, said once, so a refusal is useful. */
const REPERTOIRE =
  "I can tell you the prices, what each fare is made of, the pickup waits, " +
  "what the dearer options buy you, how the estimates are made and what they " +
  "do not know — and I can re-run the comparison, swap the trip, re-sort it, " +
  "filter it, watch a price, or open any of the panels below.";

/**
 * Answer from the brief, or say plainly that there is no answer here.
 *
 * Ordered most specific first: an intent to *act* beats a question about the
 * same subject, because "sort by fastest" and "which is fastest" want
 * different things, and a question that names an option beats the general
 * form of the same question.
 */
export function answerLocally(question: string, brief: AssistantBrief): LocalReply {
  const q = normalise(question);
  const say = (text: string, action: AssistantAction | null = null): LocalReply => ({
    text,
    action,
    refused: false,
  });

  if (!q.trim()) {
    return { text: `Ask me something about this trip. ${REPERTOIRE}`, action: null, refused: true };
  }

  /* ── Things to do ─────────────────────────────────────────────────────── */

  if (has(q, "refresh", "recheck", "update", "again", "rerun") || q.includes(" re run ")) {
    return say("Re-running the comparison now.", { action: "refresh" });
  }

  if (
    has(q, "swap", "reverse", "back") ||
    q.includes(" the other way ") ||
    q.includes(" way back ") ||
    q.includes(" round trip ")
  ) {
    return say(
      "Swapping the trip and pricing the way back. The Return panel prices the reverse leg on its own.",
      { action: "swap" },
    );
  }

  if (has(q, "sort", "order", "rank")) {
    const mode = has(q, "fastest", "quickest", "soonest")
      ? "fastest"
      : has(q, "value", "balanced")
        ? "best_value"
        : "cheapest";
    return say(`Sorted by ${mode === "best_value" ? "value" : mode}.`, { action: "rank", mode });
  }

  if (has(q, "only", "filter", "just", "show")) {
    const category = has(q, "taxi", "cab")
      ? "TAXI"
      : has(q, "xl", "bigger", "larger", "van")
        ? "XL"
        : has(q, "premium", "black", "lux", "luxury")
          ? "PREMIUM"
          : has(q, "all", "everything")
            ? "ALL"
            : has(q, "standard", "normal", "regular")
              ? "standard"
              : null;
    if (category) return say(`Showing ${category} rides.`, { action: "filter", category });
  }

  if (has(q, "watch", "alert", "notify", "tell") && has(q, "drops", "falls", "under", "below")) {
    const threshold = thresholdIn(q);
    if (threshold != null) {
      return say(
        `Watching this trip for $${threshold.toFixed(2)} or less. Nothing runs in the background — it is checked the next time you open RideLens.`,
        { action: "watch", threshold },
      );
    }
    return say("Tell me the figure to watch for — say a price, like 'watch under $40'.");
  }

  /* ── Questions about the trip ─────────────────────────────────────────── */

  /*
   * Honesty first. "Is this real?" is the question this product exists to
   * answer, and it is answered from the brief's own limits rather than from
   * anything written here, so it stays true when the limits change.
   */
  if (
    has(q, "real", "live", "accurate", "trust", "reliable", "actual", "guaranteed", "sure") ||
    q.includes(" how do you know ") ||
    q.includes(" where do these come from ") ||
    q.includes(" how does this work ")
  ) {
    return say(
      sentences(brief.limits[0], brief.limits[1], brief.limits[2], brief.yourHistory ?? undefined),
      { action: "panel", panel: "whatif" },
    );
  }

  const named = optionNamed(q, brief.options);

  /* What a fare is made of — the question the charge list exists for. */
  if (
    has(q, "breakdown", "fees", "fee", "surcharge", "surcharges", "taxes", "tolls", "charges") ||
    q.includes(" made of ") ||
    q.includes(" made up of ") ||
    q.includes(" what am i paying ") ||
    (has(q, "why") && has(q, "expensive", "dearer", "more", "costly", "pricey"))
  ) {
    const option = named ?? brief.options[0];
    if (!option) return say("There are no options on screen to break down.");
    const madeOf = option.madeOf.map((m) => `${m.part} ${m.amount}`).join(", ");
    const charges = option.charges.map((c) => `${c.name} ${c.amount}`).join(", ");
    return say(
      sentences(
        `${nameOf(option)} is ${option.price}.`,
        madeOf ? `It is built from ${madeOf}.` : null,
        charges ? `The charges in it: ${charges}.` : null,
        "Those parts add up to the model's centre, which is not a price anyone was quoted — the range is the price.",
      ),
      { action: "panel", panel: "breakdown" },
    );
  }

  /* Pickup wait. */
  if (has(q, "wait", "waiting", "pickup", "arrive", "arrival", "eta", "soon", "long")) {
    if (named) {
      return say(
        named.pickupWait
          ? sentences(
              `${nameOf(named)}: pickup wait ${named.pickupWait}.`,
              named.arrivesIn ? `The drive itself is ${named.arrivesIn}.` : null,
            )
          : `I don't have a pickup wait for ${nameOf(named)}.`,
      );
    }
    const waits = brief.options
      .filter((o) => o.pickupWait)
      .map((o) => `${nameOf(o)} ${o.pickupWait}`)
      .join(", ");
    return say(
      waits
        ? `Pickup waits: ${waits}.`
        : "I don't have pickup waits for this comparison — they are not in the brief.",
    );
  }

  /* What the extra buys. Already written out; never re-derived. */
  if (
    has(q, "worth", "tradeoff", "tradeoffs", "faster", "quicker", "save", "saves") ||
    q.includes(" worth it ") ||
    q.includes(" trade off ")
  ) {
    return say(
      brief.tradeoffs.length > 0
        ? brief.tradeoffs.join(" ")
        : "Nothing here is dearer in a way that buys time, so there is no trade-off to weigh.",
      { action: "panel", panel: "tradeoffs" },
    );
  }

  /* Distance and drive time. */
  if (has(q, "far", "distance", "miles", "drive", "journey") && !has(q, "wait")) {
    return say(
      sentences(
        brief.route.miles
          ? `${brief.route.from} to ${brief.route.to} is ${brief.route.miles}.`
          : null,
        brief.route.drive ? `The drive is ${brief.route.drive}.` : null,
        !brief.route.miles && !brief.route.drive
          ? "I don't have a distance or a drive time for this route."
          : null,
      ),
    );
  }

  /* The market the prices were produced under. */
  if (has(q, "demand", "surge", "busy", "weather", "raining", "rain", "market")) {
    return say(
      sentences(
        `Demand is ${brief.market.demand}.`,
        brief.market.weather ? `Weather: ${brief.market.weather}.` : null,
        `Model version ${brief.market.modelVersion}.`,
        "That is a modeled marketplace, not a reading from any provider.",
      ),
    );
  }

  /* The rider's own record. */
  if (has(q, "history", "before", "previously", "usually", "past") || q.includes(" my trips ")) {
    return say(
      brief.yourHistory ??
        "You have not logged enough trips on this route for me to say anything about it yet.",
    );
  }

  /*
   * Which one, and how much. Last of the question intents, because it is the
   * broadest — "how much is the Lyft" should have been caught above only if
   * it asked about fees, and otherwise lands here.
   */
  if (
    named ||
    has(q, "cheapest", "best", "price", "prices", "cost", "costs", "much", "which", "options")
  ) {
    if (brief.options.length === 0) {
      return say("There are no options on screen right now — run a comparison and ask me again.");
    }
    if (named) {
      return say(
        sentences(
          `${nameOf(named)} is ${named.price}.`,
          `Confidence ${named.confidence}, ${named.basis}.`,
        ),
      );
    }
    return say(
      sentences(
        brief.ordering,
        `On screen now: ${listOptions(brief.options)}.`,
        "Tips are not included, and the provider sets the final fare at booking.",
      ),
      { action: "panel", panel: "spread" },
    );
  }

  /* A panel by name, when the question was really "show me the X". */
  const panel = panelAsked(q);
  if (panel) {
    const definition = PANELS.find((p) => p.id === panel)!;
    return say(`Opening ${definition.label} — ${definition.question}`, { action: "panel", panel });
  }

  /*
   * Nothing matched. Rule 5: "I don't have that" is a complete and correct
   * answer, and the alternative — stretching a near-match over a question
   * this does not understand — is how an invented figure gets written.
   */
  return {
    text: `I don't have an answer for that one. ${REPERTOIRE}`,
    action: null,
    refused: true,
  };
}
