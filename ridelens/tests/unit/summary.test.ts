/**
 * The text summary has to hold the same line as the screen. A paste that
 * rounds a range or drops an unavailable provider would undo the product's
 * whole claim in one message.
 */
import { describe, expect, it } from 'vitest';
import { buildTripSummary } from '@/domain/summary';
import type { NormalizedQuote } from '@/domain/quote';

function quote(over: Partial<NormalizedQuote>): NormalizedQuote {
  return {
    id: 'q1',
    provider: 'taxi',
    providerProductId: 'nyc-flat',
    providerProductName: 'JFK ↔ Manhattan flat fare',
    normalizedCategory: 'TAXI',
    priceType: 'UPFRONT_QUOTE',
    priceMinMinor: 7475,
    priceMaxMinor: 7475,
    displayPriceMinor: 7475,
    rankingPriceMinor: 7475,
    currency: 'USD',
    pickupEtaSeconds: null,
    tripDurationSeconds: null,
    distanceMeters: 27000,
    availability: 'UNKNOWN',
    source: 'public_rate_card',
    sourceMethod: 'PUBLISHED_TARIFF',
    accountContext: 'PUBLIC',
    receivedAt: new Date().toISOString(),
    providerTimestamp: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    freshness: 'LIVE',
    bookingHandoff: null,
    confidenceClass: 'HIGH',
    metadata: {},
    ...over,
  } as NormalizedQuote;
}

const AT = new Date('2026-09-04T15:00:00Z');

describe('trip summary', () => {
  it('keeps a range as a range', () => {
    const text = buildTripSummary({
      pickupLabel: 'Union Square',
      destinationLabel: 'Washington Square Park',
      quotes: [
        quote({
          priceType: 'ESTIMATE_RANGE',
          priceMinMinor: 2700,
          priceMaxMinor: 3400,
          providerProductName: 'Citi Bike',
        }),
      ],
      unavailable: [],
      at: AT,
    });
    // The shared money formatter drops ".00" when both ends are whole, so the
    // range reads "$27–34" — and it is still unmistakably a range.
    expect(text).toContain('$27–34');
    expect(text).toContain('estimated range');
    // The midpoint must not appear anywhere: a range collapsed to one number is
    // exactly the false precision this product exists to avoid.
    expect(text).not.toContain('$30.50');
    expect(text).not.toContain('$31');
  });

  it('labels an upfront fare as upfront and a metered one as metered', () => {
    const text = buildTripSummary({
      pickupLabel: 'A',
      destinationLabel: 'B',
      quotes: [quote({}), quote({ id: 'q2', priceType: 'METERED_ESTIMATE' })],
      unavailable: [],
      at: AT,
    });
    expect(text).toContain('(upfront)');
    expect(text).toContain('(metered estimate)');
  });

  it('names what was unavailable rather than dropping it', () => {
    const text = buildTripSummary({
      pickupLabel: 'A',
      destinationLabel: 'B',
      quotes: [quote({})],
      unavailable: [{ label: 'uber_direct', reason: 'No authorized data agreement' }],
      at: AT,
    });
    expect(text).toContain('Not available:');
    expect(text).toContain('uber_direct: No authorized data agreement');
  });

  it('says plainly when nothing came back', () => {
    const text = buildTripSummary({
      pickupLabel: 'A',
      destinationLabel: 'B',
      quotes: [],
      unavailable: [],
      at: AT,
    });
    expect(text).toContain('No provider returned a price.');
  });

  it('marks the result as a snapshot, because prices move', () => {
    const text = buildTripSummary({
      pickupLabel: 'A',
      destinationLabel: 'B',
      quotes: [quote({})],
      unavailable: [],
      at: AT,
    });
    expect(text).toContain('snapshot');
    expect(text).toContain('A → B');
  });
});

describe('a summary of a departure that has not happened yet', () => {
  /*
   * The thing people do with a comparison is paste it. A fare priced for
   * Tuesday morning, pasted as "Checked 9:41 PM · prices move, so this is a
   * snapshot", reads in a chat as tonight's price — which is the wrong-number
   * problem this product exists to avoid, arriving by the one route that
   * leaves the screen.
   */
  const DEPARTURE = '2026-09-09T10:20:00.000Z';

  function scheduled() {
    return {
      pickupLabel: 'Union Square',
      destinationLabel: 'JFK',
      quotes: [{ ...quote({ priceMinMinor: 7475 }), scheduledFor: DEPARTURE }],
      unavailable: [],
      at: new Date('2026-09-08T01:41:00.000Z'),
    };
  }

  it('names the departure the prices are for', () => {
    const text = buildTripSummary(scheduled());
    const expected = new Date(DEPARTURE).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    expect(text).toContain(`For departure ${expected}`);
  });

  it('does not call a rule-fixed fare a moving snapshot', () => {
    const text = buildTripSummary(scheduled());
    expect(text).not.toContain('prices move');
    expect(text).toContain('does not move');
    // It still says when the arithmetic was done, because a rate card can be
    // superseded even though the rule itself does not drift.
    expect(text).toContain('computed');
  });

  it('leaves a live comparison exactly as it was', () => {
    const live = { ...scheduled(), quotes: [quote({ priceMinMinor: 7475 })] };
    const text = buildTripSummary(live);
    expect(text).toContain('prices move, so this is a snapshot');
    expect(text).not.toContain('For departure');
  });
});
