import { describe, expect, it } from "vitest";

import {
  MAX_AGE_DAYS,
  MAX_RECORDS,
  MIN_SAMPLES_FOR_RANGE,
  TRIP_LOG_VERSION,
  addRecord,
  cheapestLowMinor,
  historyForRoute,
  historySeries,
  pruneRecords,
  recentTrips,
  routeKeyFor,
  standingAgainstHistory,
  toRecord,
  type TripRecord,
} from "@/lib/history/trip-log";
import type { NormalizedQuote, QuoteSession } from "@/lib/domain/types";

/* Deliberately not a real MODEL_VERSION. These tests are about pooling
   behaviour, not about any particular model, and a fixture that looks like
   the live value invites the reader to assume it tracks it — one did, and
   broke silently when the version was bumped. */
const MODEL = "test-model.a";

let seq = 0;
function quote(over: Partial<NormalizedQuote> = {}): NormalizedQuote {
  seq += 1;
  const min = over.priceMinMinor ?? 2500;
  const max = over.priceMaxMinor ?? min;
  return {
    id: `q${seq}`,
    provider: "uber",
    providerProductId: "uberx",
    providerProductName: "UberX",
    normalizedCategory: "STANDARD",
    priceType: "ESTIMATE_RANGE",
    priceMinMinor: min,
    priceMaxMinor: max,
    displayPriceMinor: min,
    rankingPriceMinor: Math.round((min + max) / 2),
    currency: "USD",
    pickupEtaSeconds: 300,
    tripDurationSeconds: 1800,
    distanceMeters: 8000,
    availability: "AVAILABLE",
    source: "public_rate_card",
    sourceMethod: "public_rate_card",
    accountContext: "PUBLIC",
    receivedAt: new Date().toISOString(),
    providerTimestamp: null,
    expiresAt: null,
    freshness: "LIVE",
    bookingHandoff: null,
    confidenceClass: "MEDIUM",
    metadata: {},
    ...over,
  };
}

function session(over: Partial<QuoteSession> = {}): QuoteSession {
  return {
    id: `s${(seq += 1)}`,
    status: "SUCCESS",
    pickup: { lat: 40.7128, lng: -74.006, formattedAddress: "1 Wall St, New York, NY" },
    destination: { lat: 40.6413, lng: -73.7781, formattedAddress: "JFK Airport, Queens, NY" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

/** n records of the same route, each with the given cheapest low/high. */
function logOf(bands: Array<[number, number]>, over: Partial<TripRecord> = {}): TripRecord[] {
  return bands.map((band, i) => {
    const rec = toRecord(
      session({
        id: `s-${i}-${band[0]}`,
        createdAt: new Date(Date.UTC(2026, 8, i + 1)).toISOString(),
        quotes: [quote({ priceMinMinor: band[0], priceMaxMinor: band[1] })],
      }),
      MODEL,
    );
    if (!rec) throw new Error("fixture produced no record");
    return { ...rec, ...over };
  });
}

describe("what counts as the same trip", () => {
  it("treats two taps on the same corner as one route", () => {
    const a = routeKeyFor(
      { lat: 40.712812, lng: -74.006015, label: "A" },
      { lat: 40.64, lng: -73.77, label: "B" },
    );
    const b = routeKeyFor(
      { lat: 40.712844, lng: -74.006098, label: "A" },
      { lat: 40.64, lng: -73.77, label: "B" },
    );
    expect(a).toBe(b);
  });

  /* The run home prices differently from the run out. Direction is kept. */
  it("does not fold the return leg into the outbound one", () => {
    const from = { lat: 40.7128, lng: -74.006, label: "A" };
    const to = { lat: 40.6413, lng: -73.7781, label: "B" };
    expect(routeKeyFor(from, to)).not.toBe(routeKeyFor(to, from));
  });

  it("separates genuinely different pickups", () => {
    const a = routeKeyFor(
      { lat: 40.7128, lng: -74.006, label: "A" },
      { lat: 40.64, lng: -73.77, label: "B" },
    );
    const b = routeKeyFor(
      { lat: 40.7228, lng: -74.006, label: "A" },
      { lat: 40.64, lng: -73.77, label: "B" },
    );
    expect(a).not.toBe(b);
  });
});

describe("recording a comparison", () => {
  it("keeps the band it was shown and never a midpoint", () => {
    const rec = toRecord(
      session({ quotes: [quote({ priceMinMinor: 2000, priceMaxMinor: 3000 })] }),
      MODEL,
    );
    expect(rec?.quotes[0].lowMinor).toBe(2000);
    expect(rec?.quotes[0].highMinor).toBe(3000);
    /* 2500 is the rankingPriceMinor. It is a number nobody was quoted. */
    expect(JSON.stringify(rec)).not.toContain("2500");
  });

  /*
   * A comparison that priced nothing is not an observation that the trip cost
   * anything, and logging it would put a zero-sample record into the n.
   */
  it("refuses a comparison with nothing priced", () => {
    expect(toRecord(session({ quotes: [] }), MODEL)).toBeNull();
    expect(
      toRecord(session({ quotes: [quote({ availability: "UNAVAILABLE" })] }), MODEL),
    ).toBeNull();
  });

  it("carries the model version that produced it", () => {
    expect(toRecord(session(), MODEL)?.modelVersion).toBe(MODEL);
  });

  it("stamps the shape version so a later build can drop what it cannot read", () => {
    expect(toRecord(session(), MODEL)?.v).toBe(TRIP_LOG_VERSION);
  });
});

describe("keeping the log honest about its size", () => {
  /*
   * A stream delivering two events for one session, or a refresh reusing it,
   * must not turn one comparison into two observations. An inflated n is
   * worse than no n.
   */
  it("counts one comparison once, however many times it arrives", () => {
    const rec = toRecord(session({ id: "same" }), MODEL)!;
    let log = addRecord([], rec);
    log = addRecord(log, { ...rec, at: new Date().toISOString() });
    log = addRecord(log, rec);
    expect(log).toHaveLength(1);
  });

  it("drops records older than the window", () => {
    const now = Date.UTC(2026, 8, 26);
    const old = Date.UTC(2026, 8, 26) - (MAX_AGE_DAYS + 1) * 86_400_000;
    const records = [
      { ...logOf([[2000, 2000]])[0], at: new Date(old).toISOString() },
      { ...logOf([[2100, 2100]])[0], at: new Date(now - 86_400_000).toISOString() },
    ];
    expect(pruneRecords(records, now)).toHaveLength(1);
  });

  it("drops records written by a shape this build does not read", () => {
    const rec = { ...logOf([[2000, 2000]])[0], v: TRIP_LOG_VERSION + 1 };
    expect(pruneRecords([rec], Date.UTC(2026, 8, 26))).toHaveLength(0);
  });

  it("caps the log and keeps the newest", () => {
    const many = Array.from({ length: MAX_RECORDS + 20 }, (_, i) => ({
      ...logOf([[2000 + i, 2000 + i]])[0],
      id: `r${i}`,
      at: new Date(Date.UTC(2026, 8, 26) - i * 60_000).toISOString(),
    }));
    const pruned = pruneRecords(many, Date.UTC(2026, 8, 26));
    expect(pruned).toHaveLength(MAX_RECORDS);
    expect(pruned[0].id).toBe("r0");
  });
});

describe("offering a trip back", () => {
  it("collapses six runs of one commute into one row", () => {
    const log = logOf([
      [2000, 2100],
      [2200, 2300],
      [2400, 2500],
    ]);
    const recents = recentTrips(log);
    expect(recents).toHaveLength(1);
    expect(recents[0].times).toBe(3);
  });

  it("puts the most recently compared route first", () => {
    const jfk = logOf([[2000, 2000]]).map((r) => ({
      ...r,
      at: new Date(Date.UTC(2026, 8, 25)).toISOString(),
    }));
    const lga = logOf([[3000, 3000]]).map((r) => ({
      ...r,
      id: "lga",
      routeKey: "other",
      at: new Date(Date.UTC(2026, 8, 20)).toISOString(),
    }));
    const recents = recentTrips([...jfk, ...lga]);
    expect(recents[0].routeKey).toBe(jfk[0].routeKey);
  });
});

describe("what this route has cost before", () => {
  /*
   * The refusal is the feature. A range drawn from two looks is not a range,
   * and "you have only compared this twice" is a true and useful answer.
   */
  it("refuses to summarise below the stated minimum", () => {
    const log = logOf(
      Array.from(
        { length: MIN_SAMPLES_FOR_RANGE - 1 },
        (_, i) => [2000 + i, 2100 + i] as [number, number],
      ),
    );
    expect(historyForRoute(log, log[0].routeKey, MODEL)).toBeNull();
  });

  it("summarises once there are enough, and says how many", () => {
    const log = logOf([
      [1800, 1900],
      [2600, 3400],
      [2200, 2300],
    ]);
    const h = historyForRoute(log, log[0].routeKey, MODEL)!;
    expect(h.n).toBe(3);
    expect(h.cheapestLowMinor).toBe(1800);
    expect(h.cheapestHighMinor).toBe(3400);
  });

  /*
   * Records from another model describe a different estimator. Pooling them
   * would produce a series no estimator ever produced.
   */
  it("never pools two model versions, and says how many it left out", () => {
    const current = logOf([
      [1800, 1900],
      [2000, 2100],
      [2200, 2300],
    ]);
    const older = logOf([[100, 100]]).map((r) => ({
      ...r,
      id: "old",
      modelVersion: "test-model.b",
    }));
    const h = historyForRoute([...current, ...older], current[0].routeKey, MODEL)!;
    expect(h.n).toBe(3);
    expect(h.cheapestLowMinor).toBe(1800);
    expect(h.excludedOtherModel).toBe(1);
  });

  it("falls back to null when the only records are from another model", () => {
    const older = logOf([
      [1800, 1900],
      [2000, 2100],
      [2200, 2300],
    ]).map((r) => ({ ...r, modelVersion: "test-model.b" }));
    expect(historyForRoute(older, older[0].routeKey, MODEL)).toBeNull();
  });

  it("counts which provider actually came out cheapest", () => {
    const log = [
      ...logOf([[1800, 1900]]),
      ...logOf([[2000, 2100]]).map((r) => ({ ...r, id: "b" })),
      ...logOf([[2200, 2300]]).map((r) => ({ ...r, id: "c" })),
    ];
    const h = historyForRoute(log, log[0].routeKey, MODEL)!;
    expect(h.winners[0].provider).toBe("uber");
    expect(h.winners[0].times).toBe(3);
  });
});

describe("where today sits against what you have seen", () => {
  const history = {
    routeKey: "k",
    n: 6,
    cheapestLowMinor: 2000,
    cheapestHighMinor: 5000,
    firstAt: "2026-08-01T00:00:00.000Z",
    lastAt: "2026-09-20T00:00:00.000Z",
    winners: [],
    excludedOtherModel: 0,
  };

  it("names a new low and a new high", () => {
    expect(standingAgainstHistory(1900, history).label).toBe("cheapest_seen");
    expect(standingAgainstHistory(5200, history).label).toBe("dearest_seen");
  });

  it("places a price inside the span", () => {
    expect(standingAgainstHistory(2500, history).label).toBe("below_usual");
    expect(standingAgainstHistory(3500, history).label).toBe("in_range");
    expect(standingAgainstHistory(4500, history).label).toBe("above_usual");
  });

  /* Every sentence carries its own n, so a caller cannot quietly drop it. */
  it("always says how many looks it is speaking from", () => {
    for (const price of [1500, 2500, 3500, 4500, 5500]) {
      expect(standingAgainstHistory(price, history).text).toContain("6");
    }
  });

  /* One price seen six times has no thirds to divide. */
  it("does not divide a flat span into thirds", () => {
    const flat = { ...history, cheapestLowMinor: 3000, cheapestHighMinor: 3000 };
    expect(standingAgainstHistory(3000, flat).label).toBe("cheapest_seen");
  });

  /*
   * Nothing here may read as a forecast. The log is past-tense by
   * construction and the words have to be too.
   */
  it("never promises anything about a later price", () => {
    for (const price of [1500, 2500, 3500, 4500, 5500]) {
      const { text } = standingAgainstHistory(price, history);
      expect(text).not.toMatch(/will|expect|likely|should|tomorrow|later|wait/i);
    }
  });
});

describe("one definition of cheapest", () => {
  /*
   * The log summarises on the lowest low. If the results panel measured today
   * by any other rule — a midpoint, the hero's display price — every fresh
   * comparison would read dearer than it was, in a direction nobody notices.
   */
  it("picks the same option the summary is built from", () => {
    const log = logOf([
      [1800, 4000],
      [2000, 2100],
      [2200, 2300],
    ]);
    const h = historyForRoute(log, log[0].routeKey, MODEL)!;
    expect(h.cheapestLowMinor).toBe(
      cheapestLowMinor(log[0].quotes.concat(log[1].quotes, log[2].quotes)),
    );
  });

  it("has nothing to say about an empty list", () => {
    expect(cheapestLowMinor([])).toBeNull();
  });
});

describe("the shape of a route's history", () => {
  it("returns the cheapest low per comparison, oldest first", () => {
    const log = logOf([
      [2200, 2300],
      [1800, 1900],
      [2600, 2700],
    ]);
    const series = historySeries(log, log[0].routeKey, MODEL);
    expect(series).toHaveLength(3);
    expect(series.map((p) => p.lowMinor)).toEqual([2200, 1800, 2600]);
    /* Oldest first, so a chart reads left to right in time. */
    const times = series.map((p) => new Date(p.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  /* Three points is the fewest that can show a shape rather than an accident. */
  it("refuses to draw a line through too few points", () => {
    const log = logOf([
      [2200, 2300],
      [1800, 1900],
    ]);
    expect(historySeries(log, log[0].routeKey, MODEL)).toEqual([]);
  });

  /* A series spanning two estimators is a line no estimator ever drew. */
  it("never mixes model versions into one line", () => {
    const current = logOf([
      [2200, 2300],
      [1800, 1900],
      [2600, 2700],
    ]);
    const older = logOf([[100, 100]]).map((r) => ({
      ...r,
      id: "old",
      modelVersion: "test-model.b",
    }));
    const series = historySeries([...current, ...older], current[0].routeKey, MODEL);
    expect(series).toHaveLength(3);
    expect(series.some((p) => p.lowMinor === 100)).toBe(false);
  });

  it("agrees with the summary it sits beside", () => {
    const log = logOf([
      [2200, 2300],
      [1800, 1900],
      [2600, 2700],
    ]);
    const series = historySeries(log, log[0].routeKey, MODEL);
    const summary = historyForRoute(log, log[0].routeKey, MODEL)!;
    expect(Math.min(...series.map((p) => p.lowMinor))).toBe(summary.cheapestLowMinor);
  });
});
