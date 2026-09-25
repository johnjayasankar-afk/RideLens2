/**
 * Four real trips, so the product can demonstrate itself.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS EXISTS                                                          │
 * │                                                                          │
 * │ Until a rider typed two addresses, RideLens showed nothing but prose     │
 * │ about its own methodology — an answer to "why should I trust this?"       │
 * │ delivered before anybody had asked, and before a single number had been  │
 * │ shown. The most persuasive thing this product owns is a real fare, and   │
 * │ the empty screen was the one place it never appeared.                    │
 * │                                                                          │
 * │ These are NOT demonstration data. Each is a pair of real coordinates      │
 * │ that goes through the ordinary path — the live geocoder, live routing,   │
 * │ the same tariff engine — and comes back with whatever it comes back      │
 * │ with. If a rate card changes tonight, these change with it. If a source  │
 * │ is down, they fail honestly, exactly as a typed trip would.              │
 * │                                                                          │
 * │ Each was chosen to show a different thing the product can do, so the     │
 * │ set reads as a tour rather than a list of cities.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Coordinates are landmark centroids, the same kind of figure the jurisdiction
 * tests are written against, and `tests/unit/examples.test.ts` asserts that
 * every pickup still falls inside the market it claims.
 */
import type { Point } from './geo';

export interface ExampleTrip {
  id: string;
  /**
   * What the rider will see in the pickup field once the trip is loaded, and
   * what a screen reader hears. Fuller than the row's own text, which does not
   * need to repeat a city the caption beside it already names.
   */
  fromLabel: string;
  toLabel: string;
  /** The row's visible text. Short enough not to ellipsise on a phone. */
  fromShort: string;
  toShort: string;
  from: Point;
  to: Point;
  /** The market this trip is priced by, for the caption. */
  market: string;
  /** What this particular trip demonstrates. One short clause. */
  shows: string;
}

export const EXAMPLE_TRIPS: readonly ExampleTrip[] = [
  {
    id: 'nyc-jfk',
    fromLabel: 'Times Square, New York',
    toLabel: 'JFK Airport',
    fromShort: 'Times Square',
    toShort: 'JFK',
    from: { lat: 40.758, lng: -73.9855 },
    to: { lat: 40.6413, lng: -73.7781 },
    market: 'New York',
    // $70 by rule plus published surcharges, and $5.00 more between 4pm and
    // 8pm on a weekday — an exact price and a reason to care what time it is.
    shows: 'a flat airport fare, fixed by rule',
  },
  {
    id: 'dc-capitol',
    fromLabel: 'Dupont Circle, Washington',
    toLabel: 'United States Capitol',
    fromShort: 'Dupont Circle',
    toShort: 'the Capitol',
    from: { lat: 38.9097, lng: -77.0434 },
    to: { lat: 38.8899, lng: -77.0091 },
    market: 'Washington, DC',
    // Short enough for Capital Bikeshare to answer as well as the meter, which
    // is the only trip in the set that returns two modes at once.
    shows: 'a metered cab beside a live shared bike',
  },
  {
    id: 'mnr-scarsdale',
    fromLabel: 'Scarsdale, New York',
    toLabel: 'Chelsea, Manhattan',
    fromShort: 'Scarsdale',
    toShort: 'Chelsea',
    from: { lat: 41.0176, lng: -73.8035 },
    to: { lat: 40.7449, lng: -74.0079 },
    market: 'Westchester',
    // No New York cab may pick up here, so the taxi declines with the rule and
    // Metro-North answers instead. The trip that proves the product would
    // rather explain a refusal than invent a number.
    shows: 'no cab may pick up — but a train can',
  },
  {
    id: 'chi-ohare',
    fromLabel: 'The Loop, Chicago',
    toLabel: "O'Hare Airport",
    fromShort: 'The Loop',
    toShort: "O'Hare",
    from: { lat: 41.8827, lng: -87.6233 },
    to: { lat: 41.9742, lng: -87.9073 },
    market: 'Chicago',
    // Metra charges a flat zone fare and the meter charges seventeen miles, so
    // the two answers are an order of magnitude apart. Described rather than
    // quoted: a stored figure here would be the one stale number on a screen
    // that promises none.
    shows: 'the same trip by train and by cab',
  },
];
