import { describe, expect, it } from "vitest";

import { MAX_VEHICLES, findCrossover, perPerson, seatsFor, splitBoard } from "@/lib/domain/party";
import type { NormalizedQuote, RideCategory } from "@/lib/domain/types";

let seq = 0;
function quote(over: Partial<NormalizedQuote> = {}): NormalizedQuote {
  seq += 1;
  const min = over.priceMinMinor ?? 7000;
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
    pickupEtaSeconds: 180,
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

const xl = (over: Partial<NormalizedQuote> = {}) =>
  quote({
    providerProductName: "UberXL",
    normalizedCategory: "XL" as RideCategory,
    priceMinMinor: 11000,
    priceMaxMinor: 11000,
    ...over,
  });

describe("seats", () => {
  it("gives a bigger car more of them", () => {
    expect(seatsFor("XL")).toBeGreaterThan(seatsFor("STANDARD"));
    expect(seatsFor("SHARED")).toBeLessThan(seatsFor("STANDARD"));
  });
});

describe("how many cars, and what that means", () => {
  it("fits a small party in one", () => {
    const r = perPerson(quote(), 3);
    expect(r.vehicles).toBe(1);
    expect(r.splitAcrossVehicles).toBe(false);
    expect(r.perPersonLowMinor).toBe(Math.round(7000 / 3));
  });

  it("needs two sedans for five people", () => {
    const r = perPerson(quote(), 5);
    expect(r.vehicles).toBe(2);
    expect(r.splitAcrossVehicles).toBe(true);
    expect(r.partyLowMinor).toBe(14000);
  });

  it("fits five in one XL", () => {
    const r = perPerson(xl(), 5);
    expect(r.vehicles).toBe(1);
    expect(r.splitAcrossVehicles).toBe(false);
  });

  /*
   * Two cars is not two times one car: separate requests, separate surge
   * draws. A total that widens says so; one that does not is asserting they
   * price identically, which is the thing that is not true.
   */
  it("widens the top of a multi-vehicle total rather than just doubling", () => {
    const one = perPerson(quote({ priceMinMinor: 7000, priceMaxMinor: 8000 }), 4);
    const two = perPerson(quote({ priceMinMinor: 7000, priceMaxMinor: 8000 }), 5);
    expect(two.partyHighMinor).toBeGreaterThan(one.partyHighMinor * 2);
    // The floor is honest arithmetic; only the ceiling grows.
    expect(two.partyLowMinor).toBe(one.partyLowMinor * 2);
  });

  it("refuses a party that would need a fleet", () => {
    // Twelve in a four-seater is exactly three cars, which is allowed. Six
    // shared rides is not.
    const r = perPerson(quote({ normalizedCategory: "SHARED" }), 12);
    expect(r.vehicles).toBe(6);
    expect(r.vehicles).toBeGreaterThan(MAX_VEHICLES);
    expect(r.refusal).toMatch(/different kind of booking/i);
    expect(r.perPersonLowMinor).toBe(0);
  });

  it("treats one person as one person", () => {
    expect(perPerson(quote(), 1).perPersonLowMinor).toBe(7000);
  });

  it("never divides by zero or goes backwards", () => {
    expect(perPerson(quote(), 0).vehicles).toBe(1);
    expect(perPerson(quote(), -3).perPersonLowMinor).toBe(7000);
  });
});

describe("the crossover", () => {
  /* The moment the expensive-looking option is the cheap one. */
  it("names the bigger car when it clearly wins per head", () => {
    const c = findCrossover(
      [perPerson(quote({ priceMinMinor: 7000, priceMaxMinor: 7000 }), 5), perPerson(xl(), 5)],
      5,
    )!;
    expect(c.winner.quote.providerProductName).toBe("UberXL");
    expect(c.loser.vehicles).toBe(2);
    // XL: 11000/5 = 2200. Two sedans: 14000/5 = 2800 at the floor.
    expect(c.perPersonSavingMinor).toBe(600);
    expect(c.sentence).toMatch(/at least \$6\.00 a head/i);
    expect(c.sentence).toMatch(/2 × UberX/);
  });

  /*
   * At five people an XL and two sedans are often genuinely the same money.
   * Picking one would be making the choice up, the same way asserting a
   * winner between overlapping quotes would.
   */
  it("says nothing when the two are the same money", () => {
    expect(
      findCrossover(
        [
          perPerson(quote({ priceMinMinor: 5000, priceMaxMinor: 6000 }), 5),
          perPerson(xl({ priceMinMinor: 10000, priceMaxMinor: 12000 }), 5),
        ],
        5,
      ),
    ).toBeNull();
  });

  it("says nothing when nobody has to split", () => {
    expect(findCrossover([perPerson(quote(), 3), perPerson(xl(), 3)], 3)).toBeNull();
  });

  it("says nothing for a single rider", () => {
    expect(findCrossover([perPerson(quote(), 1), perPerson(xl(), 1)], 1)).toBeNull();
  });

  it("says nothing when every option has to split", () => {
    // Eleven people: three sedans or two XLs. No single-vehicle option, so
    // there is no crossover to report — only two flavours of splitting.
    const c = findCrossover([perPerson(quote(), 11), perPerson(xl(), 11)], 11);
    expect(c).toBeNull();
  });
});

describe("the whole board", () => {
  it("sorts by cost per head and puts refusals last", () => {
    // Nine people: XL takes two cars, a sedan three, a shared ride five.
    const { rows } = splitBoard(
      [
        quote({ providerProductName: "UberX", priceMinMinor: 7000, priceMaxMinor: 7000 }),
        xl({ priceMinMinor: 11000, priceMaxMinor: 11000 }),
        quote({ providerProductName: "Shared", normalizedCategory: "SHARED", priceMinMinor: 3000 }),
      ],
      9,
    );
    expect(rows.at(-1)!.refusal).toBeTruthy();
    expect(rows.at(-1)!.quote.providerProductName).toBe("Shared");
    expect(rows[0]!.refusal).toBeNull();
  });

  it("carries the crossover with it", () => {
    const { crossover } = splitBoard(
      [quote({ priceMinMinor: 7000, priceMaxMinor: 7000 }), xl()],
      5,
    );
    expect(crossover).not.toBeNull();
  });
});
