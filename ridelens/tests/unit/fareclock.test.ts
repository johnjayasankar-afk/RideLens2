/**
 * The fare clock — "cheaper later", "rises soon" — is the only forward-looking
 * number in the product. It is allowed to exist because a municipal tariff is a
 * published rule with fixed switchover times, so pricing the same measured
 * route at a later clock is arithmetic, not prophecy.
 *
 * These tests assert against the real shipped cards, so a card edit that breaks
 * the reasoning shows up here rather than in front of a rider.
 */

import { describe, expect, it } from 'vitest';
import {
  CHEAPER_HORIZON_MINUTES,
  RISE_HORIZON_MINUTES,
  fareBands,
  fareByHour,
  fareOutlook,
} from '@/domain/fareclock';
import { computeFare } from '@/domain/tariff';
import { allTariffs, tariffForPickup } from '@/sources/ratecard/tariffs';

const PRINCE_ST = { lat: 40.7233, lng: -73.9959 };
const UPPER_WEST = { lat: 40.7871, lng: -73.9754 };
const JFK = { lat: 40.6413, lng: -73.7781 };

const ROUTE = { distanceMeters: 5000, durationSeconds: 900 };
const CTX = { pickup: PRINCE_ST, destination: UPPER_WEST };
/** 11:00 ET on an ordinary Tuesday. */
const MIDDAY = new Date('2026-09-08T15:00:00Z');

function nyc() {
  const t = tariffForPickup(PRINCE_ST);
  if (!t) throw new Error('NYC tariff missing');
  return t;
}

describe('fare clock', () => {
  it('warns before a rush-hour surcharge starts', () => {
    // 15:50 on a Tuesday in New York; rush hour begins at 16:00.
    const at = new Date('2026-09-08T19:50:00Z');
    const out = fareOutlook(nyc(), ROUTE, { ...CTX, at });
    expect(out?.rises).not.toBeNull();
    expect(out?.rises?.atLabel).toBe('16:00');
    expect(out?.rises?.inMinutes).toBe(10);
    expect(out?.rises?.deltaMinor).toBe(250);
  });

  it('reports the saving when rush hour ends, net of the night surcharge', () => {
    // 19:50; at 20:00 the $2.50 rush surcharge ends and $1.00 overnight begins.
    const at = new Date('2026-09-08T23:50:00Z');
    const out = fareOutlook(nyc(), ROUTE, { ...CTX, at });
    expect(out?.cheaper?.atLabel).toBe('20:00');
    expect(out?.cheaper?.deltaMinor).toBe(-150);
  });

  it('the projected price equals pricing that instant directly', () => {
    const at = new Date('2026-09-08T19:50:00Z');
    const out = fareOutlook(nyc(), ROUTE, { ...CTX, at });
    const rise = out?.rises;
    if (!rise) throw new Error('expected a rise');
    const then = new Date(at.getTime() + rise.inMinutes * 60_000);
    const direct = computeFare(nyc(), ROUTE, { ...CTX, at: then });
    expect(rise.minMinor).toBe(direct.minMinor);
    expect(rise.maxMinor).toBe(direct.maxMinor);
    expect(rise.deltaMinor).toBe(direct.minMinor - out.nowMinMinor);
  });

  it('says nothing when the next change is beyond the horizon', () => {
    // 09:00 on a Tuesday: nothing changes until 16:00, seven hours away.
    const at = new Date('2026-09-08T13:00:00Z');
    expect(fareOutlook(nyc(), ROUTE, { ...CTX, at })).toBeNull();
  });

  it('never reports a change outside its own stated horizon', () => {
    for (const tariff of allTariffs()) {
      for (let minute = 0; minute < 1440; minute += 5) {
        const at = new Date(Date.UTC(2026, 8, 8, 0, 0) + minute * 60_000);
        const out = fareOutlook(tariff, ROUTE, { ...CTX, at });
        if (!out) continue;
        if (out.cheaper) {
          expect(out.cheaper.inMinutes).toBeGreaterThan(0);
          expect(out.cheaper.inMinutes).toBeLessThanOrEqual(CHEAPER_HORIZON_MINUTES);
          expect(out.cheaper.minMinor).toBeLessThan(out.nowMinMinor);
        }
        if (out.rises) {
          expect(out.rises.inMinutes).toBeGreaterThan(0);
          expect(out.rises.inMinutes).toBeLessThanOrEqual(RISE_HORIZON_MINUTES);
          expect(out.rises.minMinor).toBeGreaterThan(out.nowMinMinor);
        }
      }
    }
  });

  it('applies to airport flat fares too, which carry their own rush surcharge', () => {
    const at = new Date('2026-09-08T19:50:00Z');
    const out = fareOutlook(nyc(), ROUTE, { pickup: JFK, destination: PRINCE_ST, at });
    expect(out?.rises?.deltaMinor).toBe(500);
  });

  it('survives a spring-forward transition without misreporting the clock', () => {
    // 01:30 EST on 8 March 2026; New York skips 02:00–03:00 entirely.
    const at = new Date('2026-03-08T06:30:00Z');
    const out = fareOutlook(nyc(), ROUTE, { ...CTX, at });
    if (!out?.cheaper) return;
    const then = new Date(at.getTime() + out.cheaper.inMinutes * 60_000);
    const direct = computeFare(nyc(), ROUTE, { ...CTX, at: then });
    // Whatever the label says, it is the label of the instant actually priced.
    expect(out.cheaper.minMinor).toBe(direct.minMinor);
    expect(out.cheaper.atLabel).toBe(
      `${String(direct.localTime.hour).padStart(2, '0')}:${String(direct.localTime.minute).padStart(2, '0')}`,
    );
  });

  it('returns nothing for a tariff with no time-varying surcharge', () => {
    const flat = { ...nyc(), surcharges: nyc().surcharges.filter((s) => !s.when?.window) };
    expect(fareOutlook(flat, ROUTE, CTX)).toBeNull();
  });
});

describe('the day as a curve', () => {
  it('collapses the next 24 hours into the bands a person would describe', () => {
    const bands = fareBands(fareByHour(nyc(), ROUTE, { ...CTX, at: MIDDAY }));
    if (!bands) throw new Error('expected bands');

    // New York has exactly three prices across a weekday: overnight, plain
    // daytime, and rush hour. Not twenty-four. Starting from midday the plain
    // daytime rate is seen twice — before rush hour and again tomorrow morning
    // — because the axis is time, not a clock face.
    const prices = new Set(bands.map((b) => b.minMinor));
    expect(prices.size).toBe(3);
    expect(bands.length).toBe(4);

    const cheapest = Math.min(...bands.map((b) => b.minMinor));
    const dearest = Math.max(...bands.map((b) => b.minMinor));
    // Rush hour is $2.50 over plain daytime; overnight is $1.00 over.
    expect(dearest - cheapest).toBe(250);
  });

  it('runs forward from now, so the first band starts at this minute', () => {
    const bands = fareBands(fareByHour(nyc(), ROUTE, { ...CTX, at: MIDDAY }));
    if (!bands) throw new Error('expected bands');
    expect(bands[0]?.fromOffset).toBe(0);
    // The fixture instant is 11:00 in New York.
    expect(bands[0]?.fromLabel).toBe('11:00');
    // Rush hour, then the overnight rate, then tomorrow's plain daytime — in
    // the order the rider will meet them.
    expect(bands.map((b) => b.fromLabel)).toEqual(['11:00', '16:00', '20:00', '06:00']);
  });

  /*
   * The bug this replaced: sampling "the next 16:00" and then drawing it on a
   * midnight-to-midnight axis spliced two different days together. On Labor Day
   * — a weekday by the calendar but a holiday by the tariff — the strip showed
   * a 4pm rush-hour surcharge that the quote beside it correctly did not
   * charge, and there was no way to tell from the screen which was lying.
   */
  it('does not splice a holiday together with the working day after it', () => {
    // Labor Day 2026 is Monday 7 September; 18:00 New York is 22:00 UTC.
    const laborDayEvening = new Date(Date.UTC(2026, 8, 7, 22, 0));
    const at = { ...CTX, at: laborDayEvening };
    const shown = computeFare(nyc(), ROUTE, at);
    const bands = fareBands(fareByHour(nyc(), ROUTE, at));
    if (!bands) throw new Error('expected bands');

    // The rush-hour surcharge is weekdays excluding holidays, so right now
    // there is none — and the band covering "now" has to agree.
    const first = bands[0];
    expect(first?.fromOffset).toBe(0);
    expect(first?.minMinor).toBe(shown.minMinor);

    // Tomorrow is an ordinary Tuesday, so a rush-hour band does appear — later
    // in the strip, where it belongs, rather than behind the reader.
    const dearest = Math.max(...bands.map((b) => b.minMinor));
    const rush = bands.find((b) => b.minMinor === dearest);
    expect(rush?.fromOffset).toBeGreaterThan(0);
    expect(rush?.fromLabel).toBe('16:00');
  });

  it('every sampled point equals pricing that instant directly', () => {
    const points = fareByHour(nyc(), ROUTE, { ...CTX, at: MIDDAY });
    expect(points.length).toBeGreaterThan(40);
    expect(points[0]?.offsetMinutes).toBe(0);
    for (const p of points) {
      expect(p.minMinor).toBeGreaterThan(0);
      expect(p.maxMinor).toBeGreaterThanOrEqual(p.minMinor);
    }
  });

  it('the band containing "now" is the price on the card', () => {
    // The strip and the headline are two views of one number. If they can
    // disagree, one of them is lying to the reader, and there is no way to tell
    // which from the screen. "Now" is offset zero, which is the first band.
    for (const tariff of allTariffs()) {
      for (const hourUtc of [2, 9, 15, 21]) {
        const at = new Date(Date.UTC(2026, 8, 8, hourUtc, 17));
        const bands = fareBands(fareByHour(tariff, ROUTE, { ...CTX, at }));
        if (!bands) continue;
        const shown = computeFare(tariff, ROUTE, { ...CTX, at });
        const first = bands[0];
        expect(first?.fromOffset, `${tariff.marketName} @ ${hourUtc}Z`).toBe(0);
        expect(first?.minMinor, `${tariff.marketName} @ ${hourUtc}Z`).toBe(shown.minMinor);
        expect(first?.maxMinor, `${tariff.marketName} @ ${hourUtc}Z`).toBe(shown.maxMinor);
      }
    }
  });

  it('the bands tile the whole day exactly, with no gap and no overlap', () => {
    // The strip is drawn by laying these end to end. A missing half hour shows
    // up as a sliver of background in the middle of the bar, and an overlapping
    // one silently pushes every later band off its true position.
    const DAY = 1440;
    for (const tariff of allTariffs()) {
      const bands = fareBands(fareByHour(tariff, ROUTE, { ...CTX, at: MIDDAY }));
      if (!bands) continue;
      let cursor = 0;
      for (const b of bands) {
        expect(b.fromOffset, `${tariff.marketName}: gap or overlap`).toBe(cursor);
        expect(b.toOffset, `${tariff.marketName}: empty band`).toBeGreaterThan(b.fromOffset);
        cursor = b.toOffset;
      }
      expect(cursor, `${tariff.marketName}: day does not reach 24 hours`).toBe(DAY);
    }
  });

  it('never repeats a price in two adjacent bands', () => {
    for (const tariff of allTariffs()) {
      const bands = fareBands(fareByHour(tariff, ROUTE, { ...CTX, at: MIDDAY }));
      if (!bands) continue;
      for (let i = 1; i < bands.length; i += 1) {
        expect(
          bands[i]?.minMinor === bands[i - 1]?.minMinor &&
            bands[i]?.maxMinor === bands[i - 1]?.maxMinor,
          `${tariff.marketName}: adjacent bands at the same price`,
        ).toBe(false);
      }
    }
  });

  it('draws nothing for a tariff whose fare never moves', () => {
    const flat = { ...nyc(), surcharges: nyc().surcharges.filter((s) => !s.when?.window) };
    expect(fareBands(fareByHour(flat, ROUTE, CTX))).toBeNull();
  });
});
