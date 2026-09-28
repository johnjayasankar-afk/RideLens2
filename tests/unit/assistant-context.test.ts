import { describe, expect, it } from "vitest";

import { ASSISTANT_SYSTEM_PROMPT, buildBrief, renderBrief } from "@/lib/assistant/context";
import { ASSISTANT_TOOLS, describeAction, toAction } from "@/lib/assistant/actions";
import type { NormalizedQuote, QuoteSession } from "@/lib/domain/types";

let seq = 0;
function quote(over: Partial<NormalizedQuote> = {}): NormalizedQuote {
  seq += 1;
  const min = over.priceMinMinor ?? 6995;
  const max = over.priceMaxMinor ?? 7145;
  return {
    id: `q${seq}`,
    provider: "curb",
    providerProductId: "taxi",
    providerProductName: "Curb Taxi",
    normalizedCategory: "TAXI",
    priceType: "ESTIMATE_RANGE",
    priceMinMinor: min,
    priceMaxMinor: max,
    displayPriceMinor: min,
    rankingPriceMinor: Math.round((min + max) / 2),
    currency: "USD",
    pickupEtaSeconds: 180,
    tripDurationSeconds: 1980,
    distanceMeters: 28800,
    availability: "AVAILABLE",
    source: "public_rate_card",
    sourceMethod: "public_rate_card",
    accountContext: "PUBLIC",
    receivedAt: "2026-09-27T12:00:00.000Z",
    providerTimestamp: null,
    expiresAt: null,
    freshness: "LIVE",
    bookingHandoff: null,
    confidenceClass: "MEDIUM",
    metadata: {
      feeBreakdown: {
        nys_congestion_taxi: 2.5,
        mta_state_surcharge: 0.5,
        directional_asymmetry: 1.08,
        out_of_town_factor: 1.18,
        marketplace_rules: 0,
      },
      demandCenter: 1.02,
    },
    ...over,
  };
}

function session(over: Partial<QuoteSession> = {}): QuoteSession {
  return {
    id: "s1",
    status: "SUCCESS",
    pickup: { lat: 40.7225, lng: -73.9945, formattedAddress: "14 Prince St, New York, NY" },
    destination: { lat: 40.6446, lng: -73.7797, formattedAddress: "JFK Terminal 4, Queens, NY" },
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    coverage: {
      sourcesExpected: [],
      sourcesSucceeded: [],
      sourcesFailed: [],
      providersReturned: [],
      providersUnavailable: [],
    },
    quotes: [quote()],
    discrepancies: [],
    rankingMode: "cheapest",
    categoryFilter: "ALL",
    ...over,
  };
}

describe("what the assistant is given", () => {
  /*
   * A model handed minor units will eventually divide by a hundred in prose
   * and call the result a price. Every money figure arrives as the string the
   * rider is already looking at.
   */
  it("hands over prices as the rider sees them, never as minor units", () => {
    const text = renderBrief(buildBrief(session()));
    /* The house format, exactly as the card shows it: one dollar sign, then
       "to". The prompt tells the model to quote it verbatim, so the answer
       and the card cannot disagree. */
    expect(text).toContain("$69.95 to 71.45");
    expect(text).not.toContain("6995");
    expect(text).not.toContain("7145");
  });

  /* The midpoint is a number nobody was ever quoted. */
  it("never puts a midpoint in the brief", () => {
    const text = renderBrief(buildBrief(session()));
    expect(text).not.toContain("70.70");
    expect(text).not.toContain("7070");
  });

  /*
   * `directional_asymmetry: 1.08` is a ratio. A model shown a bare 1.08 in a
   * list of dollar amounts will eventually describe it as $1.08.
   */
  it("leaves multipliers and weights out of the charge list", () => {
    const brief = buildBrief(session());
    const names = brief.options[0].charges.map((c) => c.name).join(" ");
    expect(names).not.toMatch(/asymmetry|factor/);
    expect(names).toContain("congestion");
  });

  it("drops charges that are zero rather than naming them", () => {
    const brief = buildBrief(session());
    expect(brief.options[0].charges.some((c) => c.name.includes("time-of-day"))).toBe(false);
  });

  it("names the statutory charges in words a reader could check", () => {
    const text = renderBrief(buildBrief(session()));
    expect(text).toContain("New York State congestion surcharge");
    expect(text).toContain("MTA state surcharge");
  });

  /*
   * The limits are stated rather than left to be inferred. The model cannot
   * work out on its own that the corpus is empty.
   */
  it("says out loud what is not known", () => {
    const brief = buildBrief(session());
    const limits = brief.limits.join(" ").toLowerCase();
    expect(limits).toContain("modeled estimates");
    expect(limits).toContain("never been measured");
    expect(limits).toContain("tips");
    expect(limits).toContain("promotions");
  });

  it("marks an upfront quote as different from an estimate", () => {
    const brief = buildBrief(
      session({
        quotes: [quote({ priceType: "UPFRONT_QUOTE", priceMinMinor: 7000, priceMaxMinor: 7000 })],
      }),
    );
    expect(brief.options[0].kind).toBe("held upfront quote");
    expect(buildBrief(session()).options[0].kind).toBe("modeled estimate");
  });

  it("carries no coordinates", () => {
    const text = renderBrief(buildBrief(session()));
    expect(text).not.toContain("40.7225");
    expect(text).not.toContain("-73.9945");
  });

  it("survives a session with nothing priced", () => {
    const brief = buildBrief(session({ quotes: [] }));
    expect(brief.options).toHaveLength(0);
    expect(() => renderBrief(brief)).not.toThrow();
  });

  /* Below the minimum sample size there is nothing to say about accuracy. */
  it("says nothing about the rider's record when there is too little of it", () => {
    expect(buildBrief(session(), []).yourHistory).toBeNull();
  });
});

describe("the rules the assistant is held to", () => {
  const prompt = ASSISTANT_SYSTEM_PROMPT.toLowerCase();

  it("forbids stating a figure that is not in the brief", () => {
    expect(prompt).toContain("never state a price");
    expect(prompt).toContain("does not appear in the brief");
  });

  it("forbids averaging a band", () => {
    expect(prompt).toContain("never average a range");
    expect(prompt).toContain("midpoint");
  });

  /* The rule the whole product rests on. */
  it("forbids naming a winner when ranges overlap", () => {
    expect(prompt).toContain("overlap");
    expect(prompt).toMatch(/never say which option is cheaper/);
  });

  it("forbids calling a modeled estimate a live quote", () => {
    expect(prompt).toContain("never describe these as live quotes");
  });

  it("makes not knowing an acceptable answer", () => {
    expect(prompt).toContain("i don't have that");
  });

  it("refuses advice it has no business giving", () => {
    expect(prompt).toContain("never give investment, legal or safety advice");
  });
});

describe("what the assistant can do", () => {
  /*
   * Every action is something the rider can already do with one tap, and the
   * assistant performs none of them — it returns an intent the client runs.
   */
  it("offers only actions the interface already has", () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "refresh_comparison",
      "set_filter",
      "set_ranking",
      "swap_trip",
      "watch_price",
    ]);
  });

  it("can neither book, pay, nor send anything", () => {
    const surface = JSON.stringify(ASSISTANT_TOOLS).toLowerCase();
    for (const forbidden of ["book", "pay", "email", "send", "share", "delete", "handoff"]) {
      expect(surface, `a tool mentions "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("validates every argument before it becomes an intent", () => {
    expect(toAction("set_ranking", { mode: "cheapest" })).toEqual({
      action: "rank",
      mode: "cheapest",
    });
    expect(toAction("set_ranking", { mode: "by vibes" })).toBeNull();
    expect(toAction("set_filter", { category: "XL" })).toEqual({
      action: "filter",
      category: "XL",
    });
    expect(toAction("set_filter", {})).toBeNull();
    expect(toAction("not_a_tool", {})).toBeNull();
  });

  /* A threshold from a model is model output, and model output is untrusted. */
  it("refuses an implausible or hostile threshold", () => {
    expect(toAction("watch_price", { threshold: 40 })).toEqual({ action: "watch", threshold: 40 });
    expect(toAction("watch_price", { threshold: -5 })).toBeNull();
    expect(toAction("watch_price", { threshold: 0 })).toBeNull();
    expect(toAction("watch_price", { threshold: 99999 })).toBeNull();
    expect(toAction("watch_price", { threshold: "40" })).toBeNull();
    expect(toAction("watch_price", {})).toBeNull();
  });

  it("describes what it did in one sentence", () => {
    expect(describeAction({ action: "refresh" })).toMatch(/re-ran/i);
    expect(describeAction({ action: "watch", threshold: 40 })).toContain("$40.00");
    /* And says what a watch actually is, every time. */
    expect(describeAction({ action: "watch", threshold: 40 })).toContain("when you next open");
  });
});
