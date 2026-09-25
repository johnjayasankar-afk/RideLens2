/**
 * "When should I leave?"
 *
 * The panel this drives is the one place RideLens looks forward, so the rules
 * for what it says have to be pinned: which of several true statements is the
 * useful one, and — the part that has already been wrong once — that the
 * timeline it draws agrees with the price on the card beside it.
 */
import { describe, expect, it } from 'vitest';
import {
  ADVICE_HORIZON_MINUTES,
  clockAfter,
  formatLead,
  planDeparture,
  priceAtOffset,
  RISE_HORIZON_MINUTES,
  type DepartureOption,
} from '@/domain/departure';
import type { FareBand } from '@/domain/fareclock';
import { describeDeparture, formatDeparture } from '@/ui/DepartureTime';

const DAY = 1440;

/** Bands as the sampler emits them: tiling 24 hours from now, no gaps. */
function bands(...spec: Array<[from: number, minor: number]>): FareBand[] {
  return spec.map(([from, minMinor], i) => ({
    fromOffset: from,
    toOffset: spec[i + 1]?.[0] ?? DAY,
    fromLabel: clockAfter('12:00', from),
    toLabel: clockAfter('12:00', spec[i + 1]?.[0] ?? DAY),
    minMinor,
    maxMinor: minMinor,
  }));
}

function option(id: string, b: FareBand[], provider: DepartureOption['provider'] = 'taxi') {
  return { id, provider, label: id, currency: 'USD', bands: b };
}

describe('what a departure costs', () => {
  const b = bands([0, 2000], [240, 2500], [600, 2000]);

  it('reads the band a given moment falls in', () => {
    expect(priceAtOffset(b, 0)?.minMinor).toBe(2000);
    expect(priceAtOffset(b, 239)?.minMinor).toBe(2000);
    expect(priceAtOffset(b, 240)?.minMinor).toBe(2500);
    expect(priceAtOffset(b, 599)?.minMinor).toBe(2500);
    expect(priceAtOffset(b, 600)?.minMinor).toBe(2000);
    expect(priceAtOffset(b, DAY - 1)?.minMinor).toBe(2000);
  });

  it('clamps rather than falling off either end', () => {
    expect(priceAtOffset(b, -50)?.minMinor).toBe(2000);
    expect(priceAtOffset(b, DAY + 500)?.minMinor).toBe(2000);
  });
});

describe('which true thing to say', () => {
  it('leads with a rise the rider can still act on', () => {
    // Dearer in 30 minutes, and cheaper six hours later. Both are true; only
    // one of them is a decision.
    const advice = planDeparture([option('taxi', bands([0, 2000], [30, 2500], [360, 1500]))]);
    expect(advice?.kind).toBe('RISES_SOON');
    expect(advice?.inMinutes).toBe(30);
    expect(advice?.deltaMinor).toBe(500);
  });

  it('does not lead with a rise that is hours away', () => {
    const late = RISE_HORIZON_MINUTES + 60;
    const advice = planDeparture([option('taxi', bands([0, 2000], [late, 2500]))]);
    // Already on the cheapest rate, so the useful framing is that it holds.
    expect(advice?.kind).toBe('HOLDS_UNTIL');
    expect(advice?.nowMinor).toBe(2000);
  });

  it('picks the option whose fare the clock moves most, in proportion', () => {
    // The taxi saves more dollars, the train saves more of its own fare: $5.00
    // off $79.75 is 6%, $3.50 off $13.75 is 25%. The panel exists to answer
    // "does when I leave matter?", and for the train it matters four times as
    // much.
    const advice = planDeparture([
      option('train', bands([0, 1375], [120, 1025]), 'transit'),
      option('taxi', bands([0, 7975], [180, 7475])),
    ]);
    expect(advice?.optionId).toBe('train');
    expect(advice?.kind).toBe('SAVE_BY_WAITING');
    expect(advice?.deltaMinor).toBe(350);
  });

  it('does not let a rounding-error saving outrank a fare that swings a third', () => {
    // Chelsea to Scarsdale, as it actually came back: a $127 taxi that falls a
    // dollar overnight, and a $10.25 train that costs $3.50 more at peak.
    const advice = planDeparture([
      option('taxi', bands([0, 11795], [600, 11695])),
      option('train', bands([0, 1025], [596, 1375]), 'transit'),
    ]);
    expect(advice?.optionId).toBe('train');
    expect(advice?.kind).toBe('HOLDS_UNTIL');
  });

  it('still reports a saving beyond the horizon rather than saying nothing', () => {
    const far = ADVICE_HORIZON_MINUTES + 120;
    const advice = planDeparture([option('taxi', bands([0, 2500], [far, 2000]))]);
    expect(advice?.kind).toBe('SAVE_BY_WAITING');
    expect(advice?.inMinutes).toBe(far);
  });

  it('tells a rider already on the cheapest rate when it ends', () => {
    const advice = planDeparture([option('taxi', bands([0, 7475], [240, 7975]))]);
    expect(advice?.kind).toBe('HOLDS_UNTIL');
    expect(advice?.nowMinor).toBe(7475);
    expect(advice?.thenMinor).toBe(7975);
    expect(advice?.deltaMinor).toBe(500);
  });

  it('flags a change that lands after midnight', () => {
    // Bands here start at 12:00, so 14 hours out is 02:00 the next day.
    const advice = planDeparture([option('taxi', bands([0, 2000], [14 * 60, 2500]))]);
    expect(advice?.atLabel).toBe('02:00');
    expect(advice?.nextDay).toBe(true);
  });

  it('says nothing at all about a fare that never moves', () => {
    expect(planDeparture([option('taxi', bands([0, 2000]))])).toBeNull();
    expect(planDeparture([])).toBeNull();
  });
});

describe('the clock arithmetic the axis is drawn with', () => {
  it.each([
    ['12:00', 0, '12:00'],
    ['12:00', 360, '18:00'],
    ['12:00', 720, '00:00'],
    ['23:30', 45, '00:15'],
    ['12:00', DAY, '12:00'],
  ])('%s plus %i minutes is %s', (start, offset, expected) => {
    expect(clockAfter(String(start), Number(offset))).toBe(expected);
  });

  it.each([
    [5, 'in 5 min'],
    [59, 'in 59 min'],
    [60, 'in 1 hr'],
    [95, 'in 1 hr 35 min'],
    [180, 'in 3 hr'],
  ])('reads %i minutes as "%s"', (minutes, expected) => {
    expect(formatLead(Number(minutes))).toBe(expected);
  });
});

describe('saying which clock a departure is on', () => {
  // 2026-09-08T10:20Z is 06:20 in New York and 11:20 in London.
  const ISO = '2026-09-08T10:20:00.000Z';

  it('says it once when the reader and the market share a clock', () => {
    const readerClock = clockOf(ISO);
    expect(describeDeparture(ISO, readerClock, 'New York City')).toBe(formatDeparture(ISO));
  });

  it('adds the market clock when they do not', () => {
    // Whatever the test machine's zone, a clock deliberately unlike its own.
    const other = clockOf(ISO) === '06:20' ? '11:20' : '06:20';
    const out = describeDeparture(ISO, other, 'New York City');
    expect(out).toContain(other);
    expect(out).toContain('New York City');
  });

  it('still says something useful when the market has no name', () => {
    const other = clockOf(ISO) === '06:20' ? '11:20' : '06:20';
    expect(describeDeparture(ISO, other, null)).toMatch(/there$/);
  });

  it('falls back to the reader alone when nothing was stamped', () => {
    expect(describeDeparture(ISO, null, 'New York City')).toBe(formatDeparture(ISO));
  });

  it('does not throw on a malformed instant', () => {
    expect(describeDeparture('not-a-date', '06:20', 'New York City')).toBe('a chosen time');
  });
});

function clockOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
