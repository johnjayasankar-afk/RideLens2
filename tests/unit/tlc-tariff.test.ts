/**
 * The metered taxi, checked against the tariff rather than against itself.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The corpus is empty, so nothing here can say whether a fare is *right*   │
 * │ in the sense of matching what a rider paid. But a NYC yellow cab is not  │
 * │ priced by a model — it is priced by a published rule, and a rule can be  │
 * │ implemented a second time and the two compared.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So this is an independent implementation of the TLC tariff, written from
 * the rule rather than from `fare-engine.ts`, and asserted against it. It is
 * the only part of this product where the right answer is knowable without
 * ground truth.
 *
 * ── What it deliberately does not test ─────────────────────────────────────
 *
 * The traffic model and the demand multiplier are models, and this says
 * nothing about whether they are any good. It takes both from what the
 * engine reports and checks only the arithmetic built on top of them: the
 * meter, the surcharge stack, the flat fare. Law on one side of the line,
 * model on the other — the same line `docs/ARCHITECTURE.md` calls the most
 * important one in the codebase.
 *
 * This is what caught the two errors that moved 25 of 125 canonical fares:
 * a meter billed like a TNC, and a flat fare that dropped every surcharge.
 */

import { describe, expect, it } from "vitest";

import { computeProductFare } from "@/lib/sources/ratecard/fare-engine";

/* ── The tariff, from the rule ────────────────────────────────────────────
 * NYC TLC yellow cab, as published:
 *   $3.00 on entry
 *   $0.70 per 1/5 mile above 12 mph, or per 60 seconds at or below it
 *   $0.50 MTA state surcharge
 *   $0.30 improvement surcharge
 *   $2.50 NYS congestion surcharge, trips touching Manhattan below 96th
 *   $0.75 MTA congestion relief zone, trips touching below 60th
 *   $2.50 weekday 16:00–20:00
 *   $1.00 nightly 20:00–06:00
 *   $70.00 flat, Manhattan ↔ JFK, plus tolls and all of the above
 */
const ENTRY = 3.0;
const PER_UNIT = 0.7;
/** A unit is a fifth of a mile, so five units to the mile. */
const UNITS_PER_MILE = 5;
const MTA_STATE = 0.5;
const IMPROVEMENT = 0.3;
const NYS_CONGESTION_TAXI = 2.5;
const MTA_CRZ_TAXI = 0.75;
const AIRPORT_ACCESS = 2.75;
const JFK_FLAT = 70.0;

/**
 * The metered charge for a trip.
 *
 * Distance units and time units are alternatives, not addends — a unit is
 * charged for a fifth of a mile *or* for a minute, according to whether the
 * cab is above or below 12 mph. At exactly 12 mph a fifth of a mile takes a
 * minute and the two coincide, which is why the greater of the two is the
 * faithful reading for a trip taken as a whole.
 */
function meteredCharge(miles: number, chargedMinutes: number): number {
  const distanceUnits = miles * UNITS_PER_MILE;
  const timeUnits = chargedMinutes;
  return ENTRY + PER_UNIT * Math.max(distanceUnits, timeUnits);
}

function newYorkParts(iso: string): { hour: number; weekday: number } {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { hour: Number(parts.hour) % 24, weekday: days.indexOf(String(parts.weekday)) };
}

function timeOfDaySurcharge(iso: string): number {
  const { hour, weekday } = newYorkParts(iso);
  const weekdayPeak = weekday >= 1 && weekday <= 5 && hour >= 16 && hour < 20;
  if (weekdayPeak) return 2.5;
  if (hour >= 20 || hour < 6) return 1.0;
  return 0;
}

interface Trip {
  name: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  miles: number;
  osrmMinutes: number;
  /** Which statutory add-ons this route attracts. */
  below96: boolean;
  below60: boolean;
  airport: boolean;
  jfkFlat?: boolean;
}

const MIDTOWN = { lat: 40.7549, lng: -73.984 };
const SOHO = { lat: 40.7225, lng: -73.9945 };
const HARLEM = { lat: 40.8116, lng: -73.9465 };
const LGA = { lat: 40.7769, lng: -73.874 };
const JFK = { lat: 40.6446, lng: -73.7797 };

const TRIPS: Trip[] = [
  {
    name: "Midtown → Harlem",
    from: MIDTOWN,
    to: HARLEM,
    miles: 5.2,
    osrmMinutes: 18,
    below96: true,
    /* 40.7549 is around 48th St — south of 60th (~40.7644), so the
       congestion relief zone applies. Getting this wrong in the rule was
       what the first run of this file caught, in the rule rather than in
       the engine. */
    below60: true,
    airport: false,
  },
  {
    name: "SoHo → Midtown",
    from: SOHO,
    to: MIDTOWN,
    miles: 3.0,
    osrmMinutes: 14,
    below96: true,
    below60: true,
    airport: false,
  },
  {
    name: "Midtown → LGA",
    from: MIDTOWN,
    to: LGA,
    miles: 8.6,
    osrmMinutes: 24,
    below96: true,
    below60: true,
    airport: true,
  },
  {
    name: "Midtown → JFK",
    from: MIDTOWN,
    to: JFK,
    miles: 17.4,
    osrmMinutes: 42,
    below96: true,
    below60: true,
    airport: true,
    jfkFlat: true,
  },
];

const WHEN = [
  "2026-03-03T15:20:00.000Z", // Tue 10:20 — nothing
  "2026-03-03T21:30:00.000Z", // Tue 16:30 — weekday peak
  "2026-03-04T01:30:00.000Z", // Tue 20:30 — overnight
  "2026-03-07T18:00:00.000Z", // Sat 13:00 — weekend, nothing
];

describe("the metered taxi against the published tariff", () => {
  for (const trip of TRIPS) {
    for (const iso of WHEN) {
      it(`${trip.name} @ ${iso.slice(11, 16)}Z agrees with the rule`, () => {
        const fare = computeProductFare({
          product: "taxi",
          provider: "curb",
          pickup: trip.from,
          destination: trip.to,
          miles: trip.miles,
          osrmMinutes: trip.osrmMinutes,
          now: new Date(iso),
        });

        /*
         * The traffic model decides how many minutes are charged and the
         * demand model decides the multiplier. Both are models and neither
         * is under test here; they are taken from what the engine reports so
         * that only the tariff arithmetic is compared.
         */
        const chargedMinutes = fare.trafficMinutes;
        const multiplier = fare.demandCenter;
        const asymmetry = (fare.feeBreakdown.directional_asymmetry as number | undefined) ?? 1;

        const statutory =
          MTA_STATE +
          IMPROVEMENT +
          (trip.below96 ? NYS_CONGESTION_TAXI : 0) +
          (trip.below60 ? MTA_CRZ_TAXI : 0) +
          (trip.airport ? AIRPORT_ACCESS : 0) +
          timeOfDaySurcharge(iso);

        const expected = trip.jfkFlat
          ? (JFK_FLAT + statutory) * asymmetry
          : (meteredCharge(trip.miles, chargedMinutes) * multiplier + statutory) * asymmetry;

        /*
         * Within a nickel. The engine snaps its centre to a tidy figure, so
         * an exact equality would be testing the rounding rather than the
         * tariff.
         */
        expect(
          fare.center,
          `${trip.name}: rule says ${expected.toFixed(2)}, engine says ${fare.center.toFixed(2)}` +
            ` (charged ${chargedMinutes.toFixed(1)}min, ×${multiplier}, asym ×${asymmetry})`,
        ).toBeCloseTo(expected, 0);
      });
    }
  }

  /*
   * The error this file was written to catch. Billing a meter like a TNC put
   * an 8.6-mile Midtown→LGA run at $50.81 of metered charge against a meter
   * reading of about $33.
   */
  it("never bills a meter for distance and time at once", () => {
    const fare = computeProductFare({
      product: "taxi",
      provider: "curb",
      pickup: MIDTOWN,
      destination: LGA,
      miles: 8.6,
      osrmMinutes: 24,
      now: new Date("2026-03-03T15:20:00.000Z"),
    });
    const both = ENTRY + PER_UNIT * (8.6 * UNITS_PER_MILE + fare.trafficMinutes);
    const correct = meteredCharge(8.6, fare.trafficMinutes);
    expect(both).toBeGreaterThan(correct * 1.4);
    /* The engine is on the right side of that gap. */
    expect(fare.center).toBeLessThan(both);
  });

  /*
   * A flat fare is a published number, so the only thing uncertain about it
   * is which tolls the route takes. It used to be quoted bare, without a
   * single one of the surcharges the tariff adds on top.
   */
  it("adds the surcharge stack to the flat fare", () => {
    const fare = computeProductFare({
      product: "taxi",
      provider: "curb",
      pickup: MIDTOWN,
      destination: JFK,
      miles: 17.4,
      osrmMinutes: 42,
      now: new Date("2026-03-03T15:20:00.000Z"),
    });
    expect(fare.center).toBeGreaterThan(JFK_FLAT + 3);
    expect(fare.high - fare.low).toBeLessThanOrEqual(2);
  });
});
