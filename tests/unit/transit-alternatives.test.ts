import { describe, expect, it } from "vitest";

import {
  airportAt,
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
