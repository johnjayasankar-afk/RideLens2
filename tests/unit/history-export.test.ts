import { describe, expect, it } from "vitest";

import { basisOf, exportFilename, toCsv, toJson } from "@/lib/history/export";
import type { TripRecord } from "@/lib/history/trip-log";

function record(over: Partial<TripRecord> = {}): TripRecord {
  return {
    v: 1,
    id: "s1",
    at: "2026-09-20T14:30:00.000Z",
    from: { lat: 40.7225, lng: -73.9945, label: "14 Prince St" },
    to: { lat: 40.6446, lng: -73.7797, label: "JFK Terminal 4" },
    routeKey: "40.723,-73.994>40.645,-73.780",
    miles: 17.94,
    minutes: 33.4,
    quotes: [
      {
        provider: "curb",
        product: "Curb Taxi",
        lowMinor: 6995,
        highMinor: 7145,
        type: "ESTIMATE_RANGE",
        confidence: "MEDIUM",
      },
      {
        provider: "uber",
        product: "UberX",
        lowMinor: 8100,
        highMinor: 8100,
        type: "UPFRONT_QUOTE",
        confidence: "HIGH",
      },
    ],
    modelVersion: "2026-09-25.v1",
    ...over,
  };
}

describe("what the file is allowed to call a number", () => {
  /*
   * A column headed `price` next to a date and an address reads as a
   * receipt. RideLens never saw a fare charged, and a modeled estimate filed
   * as an expense is a false statement somebody else signs.
   */
  it("never heads a money column with a word that means money changed hands", () => {
    const header = toCsv([record()]).split("\n")[0];
    for (const forbidden of ["price", "paid", "fare", "total", "amount", "cost", "charge"]) {
      expect(header).not.toContain(forbidden);
    }
  });

  it("gives the band two columns, so there is no single number to paste", () => {
    const header = toCsv([record()]).split("\n")[0];
    expect(header).toContain("estimate_low_usd");
    expect(header).toContain("estimate_high_usd");
  });

  it("names what produced each row", () => {
    expect(basisOf("UPFRONT_QUOTE")).toMatch(/upfront quote/i);
    expect(basisOf("ESTIMATE_RANGE")).toMatch(/modeled estimate/i);
    expect(basisOf("ESTIMATE")).toMatch(/modeled estimate/i);
  });

  it("says in the filename what the file holds", () => {
    expect(exportFilename("csv", new Date("2026-09-26T10:00:00Z"))).toBe(
      "ridelens-modeled-estimates-2026-09-26.csv",
    );
  });

  it("carries the model version on every row", () => {
    const lines = toCsv([record()]).trim().split("\n");
    for (const line of lines.slice(1)) expect(line).toContain("2026-09-25.v1");
  });
});

describe("the rows themselves", () => {
  /*
   * Flattening to "the cheapest each time" throws away what makes the export
   * worth having: what the alternatives were when the choice was made.
   */
  it("writes one row per option, not one per comparison", () => {
    const lines = toCsv([record()]).trim().split("\n");
    expect(lines).toHaveLength(3); // header + two options
    expect(lines[1]).toContain("Curb Taxi");
    expect(lines[2]).toContain("UberX");
  });

  it("writes money in whole cents, two places", () => {
    const line = toCsv([record()]).trim().split("\n")[1];
    expect(line).toContain("69.95");
    expect(line).toContain("71.45");
  });

  it("escapes a field that contains a comma", () => {
    const csv = toCsv([
      record({
        from: { lat: 1, lng: 2, label: 'Smith, John "Jack" Plaza' },
      }),
    ]);
    expect(csv).toContain('"Smith, John ""Jack"" Plaza"');
    /* Escaped correctly means the row still has the right shape. */
    const fields = csv
      .trim()
      .split("\n")[1]
      .match(/("([^"]|"")*"|[^,]*)/g);
    expect(fields?.filter((f) => f !== "").length).toBeGreaterThanOrEqual(11);
  });

  it("leaves a missing distance blank rather than guessing a zero", () => {
    const line = toCsv([record({ miles: null, minutes: null })])
      .trim()
      .split("\n")[1];
    expect(line).toContain(",,");
  });

  it("ends with a newline", () => {
    expect(toCsv([record()]).endsWith("\n")).toBe(true);
  });

  it("writes a header even with nothing to export", () => {
    expect(toCsv([]).trim().split("\n")).toHaveLength(1);
  });
});

describe("the JSON form", () => {
  it("carries a notice that these are not fares charged", () => {
    const parsed = JSON.parse(toJson([record()]));
    expect(parsed.notice).toMatch(/not fares charged|never observes a payment/i);
    expect(parsed.records).toHaveLength(1);
  });

  it("round-trips the record unchanged", () => {
    const one = record();
    expect(JSON.parse(toJson([one])).records[0]).toEqual(one);
  });
});
