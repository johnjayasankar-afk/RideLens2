/**
 * A committed picture of what the model currently says.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The whole product is one number, and until now a change to the model     │
 * │ moved every one of those numbers without leaving a trace in the diff.    │
 * │ Someone tuning a coefficient in `model-params.ts` saw the constant move  │
 * │ and nothing else. Whether that reprices an airport run by a dollar or    │
 * │ by twenty was invisible until it shipped.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So the fares themselves are checked in. `npm run snapshot:model` rewrites
 * the file; `tests/unit/model-snapshot.test.ts` fails when the committed
 * fares stop matching, and prints what moved and by how much.
 *
 * The point is not that the numbers are right — nothing here can say that,
 * and `docs/CALIBRATION.md` says so at length. The point is that changing
 * them has to be deliberate: the diff shows the price of every canonical
 * trip before and after, and a failing test is the prompt to bump
 * MODEL_VERSION, which is what the trip log pools observations by.
 *
 * Cases are chosen to span the things the model actually branches on —
 * market, congestion zone, airport flat rate, hour, weekday, weather — not
 * to be a large random sample. A snapshot nobody can read is a snapshot
 * nobody checks.
 */

import { writeFileSync } from "node:fs";

import { computeProductFare, type FareProduct } from "@/lib/sources/ratecard/fare-engine";
import { MODEL_VERSION } from "@/lib/sources/ratecard/model-params";

type Provider = "uber" | "lyft" | "empower" | "curb";

interface Place {
  name: string;
  lat: number;
  lng: number;
}

const PLACES: Record<string, Place> = {
  soho: { name: "SoHo", lat: 40.7225, lng: -73.9945 },
  jfk: { name: "JFK T4", lat: 40.6446, lng: -73.7797 },
  lga: { name: "LaGuardia", lat: 40.7769, lng: -73.874 },
  midtown: { name: "Midtown", lat: 40.7549, lng: -73.984 },
  harlem: { name: "Harlem", lat: 40.8116, lng: -73.9465 },
  brooklyn: { name: "Park Slope", lat: 40.6715, lng: -73.9776 },
  scarsdale: { name: "Scarsdale", lat: 41.0051, lng: -73.7846 },
};

/** Fixed instants, named for what makes each one different. */
const WHEN: Record<string, string> = {
  weekday_offpeak: "2026-03-04T15:20:00.000Z",
  weekday_am_peak: "2026-03-04T12:15:00.000Z",
  weekday_pm_peak: "2026-03-04T21:40:00.000Z",
  saturday_night: "2026-03-07T03:10:00.000Z",
  overnight: "2026-03-04T08:30:00.000Z",
};

const PRODUCTS: Array<{ product: FareProduct; provider: Provider }> = [
  { product: "uberx", provider: "uber" },
  { product: "uberxl", provider: "uber" },
  { product: "lyft", provider: "lyft" },
  { product: "taxi", provider: "curb" },
  { product: "empower", provider: "empower" },
];

interface Leg {
  id: string;
  from: keyof typeof PLACES;
  to: keyof typeof PLACES;
  miles: number;
  minutes: number;
}

const LEGS: Leg[] = [
  { id: "soho→jfk", from: "soho", to: "jfk", miles: 17.9, minutes: 33 },
  { id: "midtown→lga", from: "midtown", to: "lga", miles: 8.6, minutes: 24 },
  { id: "midtown→harlem", from: "midtown", to: "harlem", miles: 5.2, minutes: 18 },
  { id: "soho→brooklyn", from: "soho", to: "brooklyn", miles: 4.1, minutes: 16 },
  { id: "scarsdale→midtown", from: "scarsdale", to: "midtown", miles: 24.3, minutes: 52 },
];

export interface SnapshotRow {
  leg: string;
  when: string;
  product: string;
  weather: number;
  low: number;
  high: number;
  waitBoost: number;
  multiplier: number;
}

export interface Snapshot {
  modelVersion: string;
  /** Not a timestamp: a snapshot that changes every run is not a snapshot. */
  note: string;
  rows: SnapshotRow[];
}

export function buildSnapshot(): Snapshot {
  const rows: SnapshotRow[] = [];
  for (const leg of LEGS) {
    for (const [whenName, iso] of Object.entries(WHEN)) {
      for (const { product, provider } of PRODUCTS) {
        /* Dry everywhere except one wet case per leg, so the weather path is
           covered without quintupling the file. */
        const weather = whenName === "weekday_pm_peak" ? 1.6 : 1;
        const fare = computeProductFare({
          product,
          provider,
          pickup: PLACES[leg.from],
          destination: PLACES[leg.to],
          miles: leg.miles,
          osrmMinutes: leg.minutes,
          now: new Date(iso),
          weatherSurgeLift: weather,
        });
        rows.push({
          leg: leg.id,
          when: whenName,
          product: `${provider}/${product}`,
          weather,
          low: Number(fare.low.toFixed(2)),
          high: Number(fare.high.toFixed(2)),
          waitBoost: Number(fare.waitBoost.toFixed(4)),
          multiplier: Number((fare.marketplaceFactors.multiplier ?? 0).toFixed(4)),
        });
      }
    }
  }
  return {
    modelVersion: MODEL_VERSION,
    note: "Regenerate with `npm run snapshot:model`. A failing snapshot test means the model moved — decide whether that was intended, then bump MODEL_VERSION.",
    rows,
  };
}

export const SNAPSHOT_PATH = "tests/fixtures/model-snapshot.json";

/* Only when run directly, so the test can import buildSnapshot safely. */
if (process.argv[1]?.endsWith("model-snapshot.ts")) {
  const snapshot = buildSnapshot();
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `Wrote ${snapshot.rows.length} fares to ${SNAPSHOT_PATH} for model ${snapshot.modelVersion}.`,
  );
}
