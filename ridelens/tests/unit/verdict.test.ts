/**
 * The bottom line, and the things it is not allowed to say.
 *
 * The page returned a $58.43 cab and a $5.50 train and left the rider to spot
 * the difference. Saying it out loud is the easy part; saying it without
 * overclaiming is the part with rules, and these are the rules.
 */
import { describe, expect, it } from 'vitest';
import type { NormalizedQuote } from '@/domain/quote';
import { MATERIAL_SAVING_SHARE, tripVerdict } from '@/domain/verdict';
import { aOrAn, shortBy } from '@/ui/TripVerdict';

function quote(over: Partial<NormalizedQuote>): NormalizedQuote {
  return {
    id: 'q1',
    provider: 'taxi',
    providerProductId: 'p',
    providerProductName: 'Metered taxi',
    normalizedCategory: 'TAXI',
    priceType: 'METERED_ESTIMATE',
    priceMinMinor: 5843,
    priceMaxMinor: 6093,
    displayPriceMinor: 5843,
    rankingPriceMinor: 5843,
    currency: 'USD',
    pickupEtaSeconds: null,
    tripDurationSeconds: null,
    distanceMeters: 32000,
    availability: 'UNKNOWN',
    source: 'public_rate_card',
    sourceMethod: 'PUBLISHED_TARIFF',
    accountContext: 'PUBLIC',
    receivedAt: new Date().toISOString(),
    providerTimestamp: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    freshness: 'LIVE',
    scheduledFor: null,
    bookingHandoff: null,
    confidenceClass: 'MEDIUM',
    metadata: {},
    ...over,
  } as NormalizedQuote;
}

const train = (over: Partial<NormalizedQuote> = {}) =>
  quote({
    id: 'train',
    provider: 'transit',
    normalizedCategory: 'TRANSIT',
    priceType: 'UPFRONT_QUOTE',
    priceMinMinor: 550,
    priceMaxMinor: 550,
    tripDurationSeconds: 2220,
    metadata: {
      boardStation: 'Chicago Union Station',
      boardAccessMeters: 1766,
      boardAccessSeconds: 1311,
      boardAccessBasis: 'ROUTED',
      alightStation: 'Oak Park',
      alightAccessMeters: 400,
      alightAccessSeconds: 300,
      alightAccessBasis: 'ROUTED',
    },
    ...over,
  });

const bike = (over: Partial<NormalizedQuote> = {}) =>
  quote({
    id: 'bike',
    provider: 'bikeshare',
    normalizedCategory: 'BIKE',
    priceType: 'ESTIMATE_RANGE',
    priceMinMinor: 430,
    priceMaxMinor: 580,
    tripDurationSeconds: 2040,
    metadata: {
      startStation: '20th & O St NW',
      startWalkMeters: 120,
      startWalkSeconds: 90,
      endStation: 'Constitution Ave & 2nd St NW',
      endWalkMeters: 494,
      endWalkSeconds: 370,
    },
    ...over,
  });

describe('when there is a bottom line worth stating', () => {
  it('names the saving when another mode beats every car', () => {
    const v = tripVerdict([quote({})], [train()]);
    expect(v?.savingMinor).toBe(5843 - 550);
    expect(v?.winner.id).toBe('train');
    expect(v?.car.id).toBe('q1');
    expect(v?.journey?.board?.station).toBe('Chicago Union Station');
    expect(v?.journey?.board?.meters).toBe(1766);
    // And the far end, which the flat shape had no room for at all.
    expect(v?.journey?.alight?.station).toBe('Oak Park');
  });

  it('reads a bike’s own metadata, which uses different keys', () => {
    const v = tripVerdict([quote({})], [bike()]);
    expect(v?.journey?.board?.station).toBe('20th & O St NW');
    expect(v?.journey?.board?.meters).toBe(120);
    /*
     * A bike's published duration is already door to door, so its total must
     * come back to exactly that figure rather than adding the walks a second
     * time: 2040 in, 2040 out, with the legs visible inside it.
     */
    expect(v?.journey?.totalSeconds).toBe(2040);
  });

  it('says nothing when the ride ranking already leads with the cheapest', () => {
    // A $4 cab against a $5.50 train: the page is already right.
    expect(tripVerdict([quote({ priceMinMinor: 400 })], [train()])).toBeNull();
  });

  it('says nothing when the saving is not worth interrupting for', () => {
    const car = quote({ priceMinMinor: 600 });
    const barely = train({ priceMinMinor: Math.ceil(600 * (1 - MATERIAL_SAVING_SHARE)) + 1 });
    expect(tripVerdict([car], [barely])).toBeNull();
    // A fifth off the same fare is worth saying.
    expect(tripVerdict([car], [train({ priceMinMinor: 400 })])).not.toBeNull();
  });

  it('says nothing when there is no other mode at all', () => {
    expect(tripVerdict([quote({})], [])).toBeNull();
    expect(tripVerdict([], [train()])).toBeNull();
  });

  it('never subtracts across currencies', () => {
    expect(tripVerdict([quote({ currency: 'USD' })], [train({ currency: 'CAD' })])).toBeNull();
  });

  it('never recommends an option nobody could take', () => {
    /*
     * The bike source marks a quote UNAVAILABLE when the station it named has
     * no bikes left. Announcing that as the cheapest way to travel would be
     * pointing at an empty rack.
     */
    expect(tripVerdict([quote({})], [bike({ availability: 'UNAVAILABLE' })])).toBeNull();
    expect(tripVerdict([quote({})], [train({ freshness: 'EXPIRED' })])).toBeNull();

    // And a car nobody could take must not become the baseline either, or the
    // saving is measured against a fare that is not on offer.
    const deadCar = quote({ id: 'dead', availability: 'UNAVAILABLE', priceMinMinor: 100 });
    const v = tripVerdict([deadCar, quote({ id: 'live' })], [train()]);
    expect(v?.car.id).toBe('live');
  });
});

describe('a fare that does not finish the trip', () => {
  /*
   * The Loop to O'Hare, which is what this rule exists for. Metra's Milwaukee
   * West line stops at Bensenville; the airport is 3.4 km further on. The bar
   * shipped calling that "$52.93 less than a licensed taxi", which compared a
   * trip that arrives with one that does not.
   */
  const stopsShort = train({
    metadata: {
      boardStation: 'Chicago Union Station',
      boardAccessMeters: 1766,
      boardAccessSeconds: 1311,
      boardAccessBasis: 'ROUTED',
      alightStation: 'Bensenville',
      alightAccessMeters: 3447,
      alightAccessSeconds: 2553,
      alightAccessBasis: 'ESTIMATED',
    },
  });

  it('is still worth showing, and is not called a saving', () => {
    const v = tripVerdict([quote({})], [stopsShort]);
    expect(v).not.toBeNull();
    // The money is real and still leads.
    expect(v!.winner.priceMinMinor).toBe(550);
    expect(v!.savingMinor).toBe(5293);
    // But the claim is not a like-for-like one.
    expect(v!.arrives).toBe(false);
    expect(v!.journey!.gap).toBe('ALIGHT_TOO_FAR');
  });

  it('refuses a door-to-door total it cannot stand behind', () => {
    const v = tripVerdict([quote({})], [stopsShort]);
    expect(v!.journey!.totalSeconds).toBeNull();
  });

  it('reports a trip that does arrive as arriving, and totals every leg', () => {
    const v = tripVerdict([quote({})], [train()]);
    expect(v!.arrives).toBe(true);
    // 1311 walk + 2220 train + 300 walk. Not the 2220 the card used to show.
    expect(v!.journey!.totalSeconds).toBe(1311 + 2220 + 300);
  });

  it('names how far short the fare stops', () => {
    const v = tripVerdict([quote({})], [stopsShort]);
    expect(shortBy(v!)).toBe('2.1 mi');
  });
});

describe('the article in front of a provider name', () => {
  it('picks the one the name actually takes', () => {
    expect(aOrAn('Licensed taxi')).toBe('a licensed taxi');
    expect(aOrAn('Uber')).toBe('an uber');
    expect(aOrAn('Empower')).toBe('an empower');
    expect(aOrAn('Lyft')).toBe('a lyft');
  });
});
