'use client';

/**
 * The next day's fare for one option, as a strip.
 *
 * The same instrument as the results-page planner, scoped to the single quote
 * this sheet is about, and with the bands listed underneath as a legend — the
 * sheet is where a reader has come to check the working, so the numbers are
 * spelled out rather than left to a hover.
 *
 * Drawn as one bar rather than a line chart because the underlying data is a
 * step function with three or four levels, not a continuous series. A smooth
 * line would imply prices drift; they do not, they switch at 4pm.
 *
 * The axis starts at NOW and runs 24 hours forward, which is also what makes it
 * truthful: laid out on a midnight-to-midnight clock face instead, the hours
 * before now would come from tomorrow and the hours after it from today, and on
 * a holiday the two disagree.
 */
import { MINUTES_PER_DAY } from '@/domain/departure';
import type { FareBand } from '@/domain/fareclock';
import { formatMoney } from '@/domain/money';

interface Props {
  bands: FareBand[];
  currency: string;
}

export function FareDay({ bands, currency }: Props) {
  const lowest = Math.min(...bands.map((b) => b.minMinor));
  const highest = Math.max(...bands.map((b) => b.minMinor));
  const span = Math.max(1, highest - lowest);
  const startLabel = bands[0]?.fromLabel ?? '';

  return (
    <div data-testid="fare-day">
      <div
        style={{
          display: 'flex',
          height: 40,
          borderRadius: 'var(--r-sm)',
          overflow: 'hidden',
          border: '1px solid var(--border)',
          background: 'var(--surface-sunken)',
        }}
      >
        {bands.map((b) => {
          // Cheapest is the accent green, dearest amber, interpolated between.
          // Mixed against `transparent` rather than using the pre-mixed --*-soft
          // tokens: those are tuned to sit *behind body text* and are so close
          // to the page in dark mode that the whole strip read as smudges.
          const t = (b.minMinor - lowest) / span;
          return (
            <div
              key={b.fromOffset}
              title={`${b.fromLabel}–${b.toLabel} · ${formatMoney(b.minMinor, currency)}`}
              style={{
                width: `${((b.toOffset - b.fromOffset) / MINUTES_PER_DAY) * 100}%`,
                background: `color-mix(in srgb, ${t < 0.5 ? 'var(--best)' : 'var(--warn)'} ${(20 + Math.abs(t - 0.5) * 26).toFixed(0)}%, transparent)`,
              }}
            />
          );
        })}
      </div>

      <div
        className="tnum"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 'var(--sp-05)',
          fontSize: 'var(--t-2xs)',
          color: 'var(--text-4)',
        }}
      >
        <span style={{ fontWeight: 660, color: 'var(--text-2)' }}>NOW · {startLabel}</span>
        <span>+24 hr</span>
      </div>

      <ul
        style={{
          margin: 'var(--sp-3) 0 0',
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 'var(--sp-1)',
        }}
      >
        {/* In clock order, not price order, so the list reads left-to-right as a
            legend for the strip above it. The cheapest row is marked rather
            than sorted to the top. */}
        {bands.map((b) => (
          <li
            key={b.fromOffset}
            className="tnum"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--sp-3)',
              fontSize: 'var(--t-sm)',
              color: b.minMinor === lowest ? 'var(--text)' : 'var(--text-2)',
            }}
          >
            <span>
              {b.fromLabel}–{b.toLabel}
              {b.minMinor === lowest && bands.length > 1 && (
                <span style={{ color: 'var(--best)', fontWeight: 600 }}> · cheapest</span>
              )}
            </span>
            <span style={{ fontWeight: b.minMinor === lowest ? 640 : 520 }}>
              {b.minMinor === b.maxMinor
                ? formatMoney(b.minMinor, currency)
                : `${formatMoney(b.minMinor, currency)}+`}
            </span>
          </li>
        ))}
      </ul>
      {bands.some((b) => b.minMinor !== b.maxMinor) && (
        <p
          style={{
            margin: 'var(--sp-2) 0 0',
            fontSize: 'var(--t-xs)',
            color: 'var(--text-4)',
            lineHeight: 1.45,
          }}
        >
          A “+” marks a band whose fare also carries a charge we cannot pin down — time in slow
          traffic, or a toll that depends on the route taken — so the figure is the floor rather
          than the whole fare.
        </p>
      )}
    </div>
  );
}
