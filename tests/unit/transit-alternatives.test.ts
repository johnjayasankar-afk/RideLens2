import { describe, expect, it } from "vitest";

import {
  airportAt,
  subwayServed,
  transitAlternativeFor,
  walkAlternative,
  withJourneyTime,
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

  /*
   * This asserted silence, and the silence was deliberate: there was no
   * general city fare model and the module declined to invent one. What
   * changed is not that standard but what is known — the MTA's flat fare
   * with free transfers is a published rule, already in tariffs.ts with a
   * source and a date, so the price of a journey between two served points
   * needs no routing. The journey itself still does, and is still absent.
   */
  it("prices an ordinary city trip at the one published fare", () => {
    const alt = transitAlternativeFor(MIDTOWN, BROOKLYN)!;
    expect(alt.fareMinor).toBe(SUBWAY_LEG.fareMinor);
    expect(alt.durationSeconds).toBeNull();
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

/**
 * The trip that is one swipe.
 *
 * The MTA charges a flat fare with free transfers, so the price of a journey
 * between two served points is that one leg whatever the distance — a
 * published rule rather than a model, which is what lets it be stated for a
 * trip nobody has routed. What stays unstated is everything that needs a
 * schedule: whether a sensible route connects these two points, and how long
 * it takes.
 */
describe("a trip that stays on the network", () => {
  const SOHO = { lat: 40.7233, lng: -74.003 };
  const WILLIAMSBURG = { lat: 40.7081, lng: -73.9571 };

  it("prices an intra-city trip at the one published fare", () => {
    const alt = transitAlternativeFor(SOHO, WILLIAMSBURG)!;
    expect(alt.fareMinor).toBe(SUBWAY_LEG.fareMinor);
    expect(alt.label).toBe("Subway or local bus");
  });

  it("carries the fare's source and the date it was read", () => {
    const alt = transitAlternativeFor(SOHO, WILLIAMSBURG)!;
    expect(alt.sources).toHaveLength(1);
    expect(alt.sources[0]!.url).toBe(SUBWAY_LEG.source);
    expect(alt.sources[0]!.verifiedOn).toBe(SUBWAY_LEG.verifiedOn);
  });

  it("states no journey time, and says why", () => {
    const alt = transitAlternativeFor(SOHO, WILLIAMSBURG)!;
    expect(alt.durationSeconds).toBeNull();
    expect(alt.durationNote).toMatch(/not modeled/);
    /* The claim is about the tariff, never about a route existing. */
    expect(alt.durationNote).toMatch(/whether a route connects/i);
  });

  it("needs both ends on the network, not one", () => {
    const jerseyCity = { lat: 40.7178, lng: -74.0431 };
    expect(transitAlternativeFor(SOHO, jerseyCity)).toBeNull();
    expect(transitAlternativeFor(jerseyCity, SOHO)).toBeNull();
  });

  it("leaves the airport runs to their own, more specific tariff", () => {
    const alt = transitAlternativeFor(MIDTOWN, JFK)!;
    expect(alt.id).toBe("jfk-subway");
    expect(alt.fareMinor).toBeGreaterThan(SUBWAY_LEG.fareMinor);
  });

  it("says nothing at all outside the city", () => {
    const la = { lat: 34.0407, lng: -118.2468 };
    const hollywood = { lat: 34.0928, lng: -118.3287 };
    expect(transitAlternativeFor(la, hollywood)).toBeNull();
  });
});

describe("folding in a measured journey time", () => {
  const measured = {
    seconds: 3720,
    measuredAt: "2026-09-29T18:32:00.000Z",
    label: "Transitland routing",
    url: "https://www.transit.land/terms",
  };

  it("leaves the absence and its reason alone when nobody measured one", () => {
    const alt = transitAlternativeFor(MIDTOWN, JFK)!;
    expect(withJourneyTime(alt, null)).toEqual(alt);
    expect(withJourneyTime(alt, null).durationNote).toMatch(/not modeled/i);
  });

  it("replaces the note with the figure and its provenance", () => {
    const alt = withJourneyTime(transitAlternativeFor(MIDTOWN, JFK)!, measured);
    expect(alt.durationSeconds).toBe(3720);
    /* The note explained an absence. There is no longer one to explain. */
    expect(alt.durationNote).toBeNull();
    expect(alt.durationSource).toEqual({
      label: "Transitland routing",
      url: "https://www.transit.land/terms",
      measuredAt: "2026-09-29T18:32:00.000Z",
    });
  });

  it("does not mutate what it was given", () => {
    const alt = transitAlternativeFor(MIDTOWN, JFK)!;
    const before = structuredClone(alt);
    withJourneyTime(alt, measured);
    expect(alt).toEqual(before);
  });

  /* The invariant the whole change rests on. */
  it("never lets a duration exist without a source, or the reverse", () => {
    const alt = transitAlternativeFor(MIDTOWN, JFK)!;
    for (const m of [null, measured]) {
      const out = withJourneyTime(alt, m);
      expect(out.durationSeconds == null).toBe(out.durationSource == null);
    }
    const walk = walkAlternative(480)!;
    expect(walk.durationSeconds == null).toBe(walk.durationSource == null);
  });

  it("cites the router that measured a walk", () => {
    expect(walkAlternative(480)!.durationSource?.label).toMatch(/OSRM/i);
  });
});
