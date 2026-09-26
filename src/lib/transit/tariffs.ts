/**
 * Published transit fares, read off the publisher's own page.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Every figure here was checked against the operator's website on the date │
 * │ recorded beside it, not recalled. That distinction earned its keep: from │
 * │ memory this file would have said the subway was $2.90 and the JFK        │
 * │ AirTrain $8.50. Both were wrong, and a rider comparing $73 against a     │
 * │ made-up $11.50 would have had no way to tell.                            │
 * │                                                                          │
 * │ The same standard this codebase applies to rate cards: a number with a   │
 * │ source and a date, or no number.                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Fares only. Journey times are deliberately absent — see
 * src/lib/transit/types.ts for why, and what would have to be true to add
 * them.
 */

export interface TariffLeg {
  label: string;
  fareMinor: number;
  /** The page this was read from. */
  source: string;
  /** ISO date it was last read. Never guessed, never back-dated. */
  verifiedOn: string;
}

export interface TransitTariff {
  id: string;
  label: string;
  /** Legs a rider actually pays for, in order. */
  legs: TariffLeg[];
  /**
   * A leg that exists and whose price is not modeled here.
   *
   * Named rather than omitted, so a total is never quietly short. The same
   * treatment market-fees.ts gives an unmodeled regulatory stack.
   */
  unmodeled: string | null;
}

const MTA_FARES = "https://www.mta.info/fares-tolls";
const CHECKED = "2026-09-26";

/** $3.00 for subway and local bus, read off mta.info on the date below. */
export const SUBWAY_LEG: TariffLeg = {
  label: "Subway or local bus",
  fareMinor: 300,
  source: MTA_FARES,
  verifiedOn: CHECKED,
};

export const TARIFFS: Record<string, TransitTariff> = {
  "jfk-subway": {
    id: "jfk-subway",
    label: "AirTrain + subway",
    legs: [
      {
        label: "AirTrain JFK to Jamaica or Howard Beach",
        fareMinor: 875,
        source: "https://www.jfkairport.com/transportation/airtrain",
        verifiedOn: CHECKED,
      },
      SUBWAY_LEG,
    ],
    unmodeled: null,
  },
  /*
   * LGA is the cheap one and it surprises people: the Q70 is free, so the
   * whole journey is a single subway fare.
   */
  "lga-q70": {
    id: "lga-q70",
    label: "Q70 LGA Link + subway",
    legs: [
      {
        label: "Q70 LGA Link bus (free)",
        fareMinor: 0,
        source: "https://www.laguardiaairport.com/transportation/public-transport",
        verifiedOn: CHECKED,
      },
      SUBWAY_LEG,
    ],
    unmodeled: null,
  },
  "ewr-airtrain": {
    id: "ewr-airtrain",
    label: "AirTrain + NJ Transit",
    legs: [
      {
        label: "AirTrain Newark to the airport rail station",
        fareMinor: 875,
        source: "https://www.newarkairport.com/transportation/airtrain",
        verifiedOn: CHECKED,
      },
    ],
    /*
     * The NJ Transit leg into Penn Station is a real cost and is not here.
     * Newark's own page says the AirTrain fee applies "if you do not already
     * have an Amtrak or NJ Transit ticket" and points at NJ Transit for the
     * rest — so the rail fare was never on a page this was read from, and
     * inventing it would make the total look cheaper than the trip is.
     */
    unmodeled: "the NJ Transit fare into New York Penn Station",
  },
};

/** Total of the legs that are modeled. Never a claim to be the whole trip. */
export function tariffTotalMinor(tariff: TransitTariff): number {
  return tariff.legs.reduce((sum, leg) => sum + leg.fareMinor, 0);
}

/** The oldest check in a tariff — how much to trust the total. */
export function tariffVerifiedOn(tariff: TransitTariff): string {
  return tariff.legs.map((l) => l.verifiedOn).sort()[0] ?? CHECKED;
}
