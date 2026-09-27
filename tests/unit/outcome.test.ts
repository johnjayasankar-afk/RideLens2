import { describe, expect, it } from "vitest";

import {
  MAX_ELAPSED_DAYS,
  MIN_ELAPSED_MINUTES,
  REPORTS_FOR_ACCURACY,
  declineReport,
  markShared,
  personalAccuracy,
  recordChoice,
  recordOutcome,
  reportedTrips,
  tripAwaitingReport,
  unsharedReports,
} from "@/lib/history/outcome";
import type { TripRecord } from "@/lib/history/trip-log";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

let seq = 0;
function trip(over: Partial<TripRecord> = {}): TripRecord {
  seq += 1;
  return {
    v: 1,
    id: `s${seq}`,
    at: minutesAgo(90),
    from: { lat: 40.7225, lng: -73.9945, label: "14 Prince St" },
    to: { lat: 40.6446, lng: -73.7797, label: "JFK Terminal 4" },
    routeKey: "40.723,-73.994>40.645,-73.780",
    miles: 17.9,
    minutes: 33,
    quotes: [
      {
        provider: "curb",
        product: "Curb Taxi",
        lowMinor: 6995,
        highMinor: 7145,
        type: "ESTIMATE_RANGE",
        confidence: "MEDIUM",
      },
    ],
    modelVersion: "test-model.a",
    ...over,
  };
}

function chosen(over: Partial<NonNullable<TripRecord["chosen"]>> = {}) {
  return {
    quoteId: "curb:taxi",
    provider: "curb" as const,
    product: "Curb Taxi",
    lowMinor: 6995,
    highMinor: 7145,
    at: minutesAgo(90),
    ...over,
  };
}

describe("when to ask", () => {
  /*
   * The bug this whole module exists for: the question was asked on the
   * handoff page, before the rider had taken the trip.
   */
  it("does not ask about a trip that cannot be over yet", () => {
    const tooSoon = trip({ chosen: chosen({ at: minutesAgo(MIN_ELAPSED_MINUTES - 1) }) });
    expect(tripAwaitingReport([tooSoon], NOW)).toBeNull();
  });

  it("asks once the trip has plausibly finished", () => {
    const ready = trip({ chosen: chosen({ at: minutesAgo(MIN_ELAPSED_MINUTES + 1) }) });
    expect(tripAwaitingReport([ready], NOW)?.id).toBe(ready.id);
  });

  /*
   * A half-remembered fare is worse than none: it enters the corpus looking
   * exactly like an observed one.
   */
  it("stops asking once nobody would remember", () => {
    const stale = trip({
      chosen: chosen({ at: new Date(NOW - (MAX_ELAPSED_DAYS + 1) * 86_400_000).toISOString() }),
    });
    expect(tripAwaitingReport([stale], NOW)).toBeNull();
  });

  it("never asks about a trip the rider did not take", () => {
    expect(tripAwaitingReport([trip()], NOW)).toBeNull();
  });

  it("never asks twice about one already answered", () => {
    const answered = trip({
      chosen: chosen(),
      outcome: { actualMinor: 7000, at: minutesAgo(10), sharedAt: null },
    });
    expect(tripAwaitingReport([answered], NOW)).toBeNull();
  });

  it("never asks again about one that was declined", () => {
    const declined = trip({ chosen: chosen(), declined: true });
    expect(tripAwaitingReport([declined], NOW)).toBeNull();
  });

  /*
   * One question, not four. A page that opens with a form gets nothing
   * answered at all.
   */
  it("asks about one trip at a time, the most recent", () => {
    const older = trip({ chosen: chosen({ at: minutesAgo(300) }) });
    const newer = trip({ chosen: chosen({ at: minutesAgo(40) }) });
    const due = tripAwaitingReport([older, newer], NOW);
    expect(due?.id).toBe(newer.id);
  });

  it("survives a record with an unreadable timestamp", () => {
    const broken = trip({ chosen: chosen({ at: "not a date" }) });
    expect(tripAwaitingReport([broken], NOW)).toBeNull();
  });
});

describe("recording", () => {
  it("attaches the chosen option to the right trip only", () => {
    const a = trip();
    const b = trip();
    const out = recordChoice([a, b], b.id, chosen());
    expect(out.find((r) => r.id === b.id)?.chosen?.product).toBe("Curb Taxi");
    expect(out.find((r) => r.id === a.id)?.chosen).toBeUndefined();
  });

  it("keeps a reported fare on the device until it is shared", () => {
    const t = trip({ chosen: chosen() });
    const out = recordOutcome([t], t.id, 7300, new Date(NOW));
    expect(out[0].outcome?.actualMinor).toBe(7300);
    expect(out[0].outcome?.sharedAt).toBeNull();
  });

  it("marks a contribution so it is not sent twice", () => {
    const t = recordOutcome([trip({ chosen: chosen() })], "s" + seq, 7300, new Date(NOW));
    const shared = markShared(t, t[0].id, new Date(NOW));
    expect(shared[0].outcome?.sharedAt).not.toBeNull();
    expect(unsharedReports(shared)).toHaveLength(0);
  });

  it("only offers to contribute what carries a signed prediction", () => {
    const withProof = recordOutcome(
      [trip({ chosen: chosen({ claim: { routeHash: "x" } as never, signature: "sig" }) })],
      "s" + seq,
      7300,
    );
    expect(unsharedReports(withProof)).toHaveLength(1);

    const withoutProof = recordOutcome([trip({ chosen: chosen() })], "s" + seq, 7300);
    expect(unsharedReports(withoutProof)).toHaveLength(0);
  });

  it("does not ask again once declined", () => {
    const t = trip({ chosen: chosen() });
    expect(tripAwaitingReport(declineReport([t], t.id), NOW)).toBeNull();
  });
});

describe("what the rider's own record says", () => {
  const reported = (low: number, high: number, actual: number) =>
    trip({
      chosen: chosen({ lowMinor: low, highMinor: high }),
      outcome: { actualMinor: actual, at: minutesAgo(5), sharedAt: null },
    });

  it("says whether the band contained the fare", () => {
    const [inside] = reportedTrips([reported(6995, 7145, 7000)]);
    expect(inside.contained).toBe(true);
    expect(inside.missedByMinor).toBe(0);
  });

  it("measures a miss from the nearest edge, with a sign", () => {
    const [over] = reportedTrips([reported(6995, 7145, 7500)]);
    expect(over.contained).toBe(false);
    expect(over.missedByMinor).toBe(355);

    const [under] = reportedTrips([reported(6995, 7145, 6000)]);
    expect(under.missedByMinor).toBe(-995);
  });

  /*
   * A fact is available immediately; an average over three is not a
   * calibration. MIN_SAMPLES is the same bar the published corpus is held
   * to, and the two are different kinds of claim.
   */
  it("reports facts at one and refuses a statistic below the minimum", () => {
    const few = Array.from({ length: REPORTS_FOR_ACCURACY - 1 }, () => reported(6995, 7145, 7000));
    const acc = personalAccuracy(few);
    expect(acc.n).toBe(REPORTS_FOR_ACCURACY - 1);
    expect(acc.remaining).toBe(1);
    expect(acc.summary).toBeNull();
    expect(reportedTrips(few)).toHaveLength(REPORTS_FOR_ACCURACY - 1);
  });

  it("offers a statistic once there are enough", () => {
    const enough = Array.from({ length: REPORTS_FOR_ACCURACY }, (_, i) =>
      reported(6995, 7145, i < 15 ? 7000 : 7500),
    );
    const acc = personalAccuracy(enough);
    expect(acc.n).toBe(REPORTS_FOR_ACCURACY);
    expect(acc.remaining).toBe(0);
    expect(acc.summary?.coverage).toBeCloseTo(0.75, 5);
  });

  /*
   * A band that always contains the fare at its very top is technically
   * right and practically useless, so where inside the band fares land is
   * reported too.
   */
  it("says where inside the band the fares tended to land", () => {
    const low = Array.from({ length: REPORTS_FOR_ACCURACY }, () => reported(6000, 8000, 6200));
    expect(personalAccuracy(low).summary!.meanPosition).toBeLessThan(0.3);

    const high = Array.from({ length: REPORTS_FOR_ACCURACY }, () => reported(6000, 8000, 7800));
    expect(personalAccuracy(high).summary!.meanPosition).toBeGreaterThan(0.7);
  });

  it("counts nothing from trips that were never reported", () => {
    expect(personalAccuracy([trip(), trip({ chosen: chosen() })]).n).toBe(0);
  });

  it("puts the most recently reported first", () => {
    const older = trip({
      chosen: chosen(),
      outcome: { actualMinor: 1, at: minutesAgo(400), sharedAt: null },
    });
    const newer = trip({
      chosen: chosen(),
      outcome: { actualMinor: 2, at: minutesAgo(5), sharedAt: null },
    });
    expect(reportedTrips([older, newer])[0].actualMinor).toBe(2);
  });
});
