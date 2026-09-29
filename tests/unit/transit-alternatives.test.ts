import { describe, expect, it } from "vitest";

import {
  airportAt,
  subwayServed,
  transitAlternativeFor,
  walkAlternative,
  WALKABLE_MAX_SECONDS,
} from "@/lib/transit/alternatives";
import { SUBWAY_LEG, TARIFFS, tariffTotalMinor } from "@/lib/transit/tariffs";

const MIDTOWN = { lat: 40.7549, lng: -73.984 };
const JFK = { lat: 40.6413, lng: -73.7781 };
const LGA = { lat: 40.7769, lng: -73.874 };
const EWR = { lat: 40.6895, lng: -74.1745 };
const MONTAUK = { lat: 41.0359, lng: -71.9545 };
const BROOKLYN = { lat: 40.6782, lng: -73.9442 };

describe("the tariffs themselves", () => {
  /*
   * The whole point of this table. From memory it would have said the subway
   * was $2.90 and the JFK AirTrain $8.50; both are wrong, and a rider
   * comparing a $73 car against a made-up $11.50 has no way to tell.
   */
  it("gives every leg a source and a date it was read", () => {
    for (const tariff of Object.values(TARIFFS)) {
      expect(tariff.legs.length).toBeGreaterThan(0);
      for (const leg of tariff.legs) {
        expect(leg.source).toMatch(/^https:\/\//);
        expect(leg.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("holds the fares that were actually checked", () => {
    expect(SUBWAY_LEG.fareMinor).toBe(300);
    expect(tariffTotalMinor(TARIFFS["jfk-subway"]!)).toBe(1175); // 8.75 AirTrain + 3.00
    expect(tariffTotalMinor(TARIFFS["lga-q70"]!)).toBe(300); // Q70 is free
  });

  /* Naming an unpriced leg is the difference between a partial total and a
     wrong one. */
  it("says out loud which leg it has not priced", () => {
    expect(TARIFFS["ewr-airtrain"]!.unmodeled).toMatch(/NJ Transit/i);
    expect(TARIFFS["jfk-subway"]!.unmodeled).toBeNull();
  });
});

describe("where a tariff applies", () => {
  it("recognises each airport", () => {
    expect(airportAt(JFK)?.code).toBe("JFK");
    expect(airportAt(LGA)?.code).toBe("LGA");
    expect(airportAt(EWR)?.code).toBe("EWR");
    expect(airportAt(MIDTOWN)).toBeNull();
  });

  it("offers the train in either direction", () => {
    expect(transitAlternativeFor(MIDTOWN, JFK)?.id).toBe("jfk-subway");
    expect(transitAlternativeFor(JFK, MIDTOWN)?.id).toBe("jfk-subway");
  });

  it("surfaces the cheap LaGuardia answer", () => {
    const alt = transitAlternativeFor(MIDTOWN, LGA)!;
    expect(alt.fareMinor).toBe(300);
    expect(alt.label).toMatch(/Q70/);
  });

  /*
   * An AirTrain fare is the price of reaching the subway network. It says
   * nothing about JFK to the end of Long Island, and quoting it there would
   * be worse than saying nothing.
   */
  it("declines a trip the tariff does not describe", () => {
    expect(transitAlternativeFor(JFK, MONTAUK)).toBeNull();
  });

  it("declines terminal to terminal", () => {
    expect(transitAlternativeFor(JFK, LGA)).toBeNull();
  });

  it("stays silent on an ordinary city trip", () => {
    expect(transitAlternativeFor(MIDTOWN, BROOKLYN)).toBeNull();
  });
});

describe("what it refuses to claim", () => {
  /*
   * The fares are published; the journey times are not, and there is no
   * schedule source wired up. A plausible "about 55 minutes" is exactly the
   * kind of unsourced figure this codebase has already had to strip out once.
   */
  it("reports no journey time, and says why", () => {
    const alt = transitAlternativeFor(MIDTOWN, JFK)!;
    expect(alt.durationSeconds).toBeNull();
    expect(alt.durationNote).toMatch(/not modeled/i);
  });

  it("carries its sources through for the provenance sheet", () => {
    const alt = transitAlternativeFor(MIDTOWN, JFK)!;
    expect(alt.sources.length).toBeGreaterThan(0);
    for (const s of alt.sources) expect(s.url).toMatch(/^https:\/\//);
  });
});

describe("walking", () => {
  it("offers a walk that is genuinely walkable, with a real time", () => {
    const alt = walkAlternative(480)!;
    expect(alt.fareMinor).toBe(0);
    expect(alt.durationSeconds).toBe(480);
    expect(alt.durationNote).toBeNull();
  });

  it("does not suggest walking to the airport", () => {
    expect(walkAlternative(WALKABLE_MAX_SECONDS + 1)).toBeNull();
    expect(walkAlternative(3 * 3600)).toBeNull();
  });

  it("declines when nothing measured a walk", () => {
    expect(walkAlternative(null)).toBeNull();
    expect(walkAlternative(0)).toBeNull();
    expect(walkAlternative(Number.NaN)).toBeNull();
  });
});

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The tariff row used to be gated on a 22 km circle around Midtown, and a │
 * │ circle around Manhattan crosses the Hudson. Every place below was inside │
 * │ it and was told an AirTrain-plus-one-subway-swipe would get them there  │
 * │ for $11.75. None of them can be reached that way: PATH, NJ Transit,     │
 * │ Metro-North and the Staten Island ferry are all separate journeys at    │
 * │ separate fares.                                                          │
 * │                                                                          │
 * │ Fourteen tests passed throughout, because none of them asked.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
describe("where one subway fare can actually reach", () => {
  const OFF_THE_NETWORK = {
    "downtown Newark": { lat: 40.7357, lng: -74.1724 },
    "Jersey City": { lat: 40.7178, lng: -74.0431 },
    Hoboken: { lat: 40.7439, lng: -74.0324 },
    Yonkers: { lat: 40.9312, lng: -73.8988 },
    "Tompkinsville, Staten Island": { lat: 40.6265, lng: -74.0776 },
    Montauk: { lat: 41.0359, lng: -71.9545 },
  };

  const ON_THE_NETWORK = {
    Midtown: { lat: 40.7549, lng: -73.984 },
    Williamsburg: { lat: 40.7081, lng: -73.9571 },
    "Coney Island": { lat: 40.5755, lng: -73.9707 },
    "Fordham, the Bronx": { lat: 40.8618, lng: -73.8896 },
    "Howard Beach": { lat: 40.6607, lng: -73.8306 },
  };

  for (const [name, point] of Object.entries(OFF_THE_NETWORK)) {
    it(`quotes no airport fare to ${name}, which no subway reaches`, () => {
      expect(subwayServed(point)).toBe(false);
      expect(transitAlternativeFor(JFK, point)).toBeNull();
      /* Symmetric: the same journey the other way round is the same claim. */
      expect(transitAlternativeFor(point, JFK)).toBeNull();
    });
  }

  for (const [name, point] of Object.entries(ON_THE_NETWORK)) {
    it(`still quotes the airport fare to ${name}`, () => {
      expect(subwayServed(point)).toBe(true);
      const alt = transitAlternativeFor(JFK, point);
      expect(alt?.fareMinor).toBe(tariffTotalMinor(TARIFFS["jfk-subway"]!));
    });
  }

  /*
   * The direction this is allowed to be wrong in. An absent row is already
   * documented as not being a claim that transit is unavailable; a wrong
   * fare is a claim, and there is no wording that repairs it.
   */
  it("errs toward saying nothing rather than toward a fare that cannot be honoured", () => {
    /* West of the Hudson at any latitude the network does not cross. */
    expect(subwayServed({ lat: 40.75, lng: -74.03 })).toBe(false);
    expect(subwayServed({ lat: 40.6, lng: -74.06 })).toBe(false);
  });
});
