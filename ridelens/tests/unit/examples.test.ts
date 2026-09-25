/**
 * The example trips have to actually work.
 *
 * They are the first thing a visitor touches, and an example that returns
 * nothing is worse than no example at all — it demonstrates the opposite of
 * what it was put there to demonstrate. These are real coordinates on real
 * tariffs, so they can be checked against the same engine that will price them.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_TRIPS } from '@/domain/examples';
import { tariffForPickup } from '@/sources/ratecard/tariffs';
import { planRailTrip } from '@/domain/rail';
import { RAIL_SYSTEMS } from '@/sources/rail/systems';
import { distanceMeters } from '@/domain/geo';

describe('every example trip', () => {
  it('is a distinct, identifiable trip', () => {
    const ids = EXAMPLE_TRIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EXAMPLE_TRIPS.length).toBeGreaterThanOrEqual(3);
    for (const t of EXAMPLE_TRIPS) {
      expect(t.fromLabel.length, t.id).toBeGreaterThan(3);
      expect(t.toLabel.length, t.id).toBeGreaterThan(3);
      expect(t.shows.length, t.id).toBeGreaterThan(8);
      /*
       * The row's own text must stay short enough not to ellipsise on a
       * phone, and the accessible name has to contain the visible words —
       * WCAG 2.5.3, and plain sense for anyone using voice control.
       */
      expect(`${t.fromShort} → ${t.toShort}`.length, `${t.id} row text`).toBeLessThanOrEqual(34);
      expect(t.fromLabel.toLowerCase(), t.id).toContain(t.fromShort.toLowerCase());
      expect(t.toLabel.toLowerCase(), t.id).toContain(
        t.toShort.replace(/^the /i, '').toLowerCase(),
      );
    }
  });

  it('is long enough to be worth pricing and short enough to be one ride', () => {
    for (const t of EXAMPLE_TRIPS) {
      const metres = distanceMeters(t.from, t.to);
      expect(metres, `${t.id} is too short`).toBeGreaterThan(1_500);
      expect(metres, `${t.id} is too far`).toBeLessThan(80_000);
    }
  });

  /*
   * The whole point of an example is that it comes back with something. Each
   * one has to be answerable by at least one source that needs no credential —
   * a taxi tariff governing the pickup, or a railroad that serves the trip.
   */
  it('is answerable by a source that needs no credential', () => {
    for (const t of EXAMPLE_TRIPS) {
      const tariff = tariffForPickup(t.from);
      const rail = RAIL_SYSTEMS.some(
        (system) => !('reason' in planRailTrip({ pickup: t.from, destination: t.to, system })),
      );
      expect(
        tariff !== null || rail,
        `${t.id}: no taxi tariff governs the pickup and no railroad serves it`,
      ).toBe(true);
    }
  });

  it('claims a market that matches what actually prices it', () => {
    for (const t of EXAMPLE_TRIPS) {
      const tariff = tariffForPickup(t.from);
      if (!tariff) continue;
      // The caption names the market a rider would recognise; the tariff names
      // the authority. They have to be talking about the same place.
      expect(
        tariff.marketName.toLowerCase().includes(t.market.toLowerCase()) ||
          t.market.toLowerCase().includes(tariff.marketName.split(',')[0]?.toLowerCase() ?? ''),
        `${t.id}: captioned "${t.market}" but priced by ${tariff.marketName}`,
      ).toBe(true);
    }
  });

  /*
   * One example exists precisely to show the product refusing: a New York cab
   * may not pick up in Westchester, so the taxi declines and Metro-North
   * answers. If a rate card ever grew to cover it, the caption would become a
   * lie and this would say so.
   */
  it('keeps the refusal example a refusal', () => {
    const suburb = EXAMPLE_TRIPS.find((t) => t.id === 'mnr-scarsdale');
    expect(suburb, 'the suburb example has gone').toBeDefined();
    if (!suburb) return;
    expect(tariffForPickup(suburb.from), 'a taxi tariff now covers Scarsdale').toBeNull();
    const served = RAIL_SYSTEMS.some(
      (system) =>
        !('reason' in planRailTrip({ pickup: suburb.from, destination: suburb.to, system })),
    );
    expect(served, 'no railroad serves the suburb example any more').toBe(true);
  });
});
