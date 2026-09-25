'use client';

/**
 * Party size.
 *
 * Two jobs, and they used to be one. It filters out vehicles that cannot seat
 * the group — seat counts are RideLens's own model rather than provider data
 * (see domain/capacity), and it filters conservatively, because seating five
 * people in a four-seat car is a worse failure than hiding an option. It is
 * also part of the price: Chicago, DC and Philadelphia all publish a
 * per-passenger charge, so changing it re-prices rather than just re-filters.
 *
 * Laid out label-above-control like every other field in the rail. Inline, it
 * was the one row that broke the column's rhythm.
 */
import { MAX_PARTY_SIZE } from '@/domain/capacity';

interface Props {
  value: number;
  onChange: (n: number) => void;
  /** True once results exist, when a change means a re-price rather than a filter. */
  affectsPrice?: boolean;
}

export function PartySize({ value, onChange, affectsPrice = false }: Props) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--sp-3)',
          height: 20,
          marginBottom: 'var(--sp-2)',
        }}
      >
        <span className="eyebrow" id="party-size-label">
          Passengers
        </span>
        {value > 1 && (
          <span
            style={{
              fontSize: 'var(--t-xs)',
              color: 'var(--text-4)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {affectsPrice
              ? 'Re-priced where cities charge per rider'
              : 'Seats modelled by RideLens'}
          </span>
        )}
      </div>
      <div
        role="radiogroup"
        aria-labelledby="party-size-label"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${MAX_PARTY_SIZE}, minmax(0, 1fr))`,
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        {Array.from({ length: MAX_PARTY_SIZE }, (_, i) => i + 1).map((n) => {
          const selected = n === value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`party-${n}`}
              onClick={() => onChange(n)}
              className="tnum rl-press"
              style={{
                height: 36,
                fontSize: 'var(--t-base)',
                fontWeight: selected ? 660 : 520,
                color: selected ? 'var(--on-inverse)' : 'var(--text-2)',
                background: selected ? 'var(--surface-inverse)' : 'transparent',
                // A hairline between cells, none on the leading edge, so the
                // group reads as one control rather than six buttons.
                border: 'none',
                borderLeft: n === 1 ? 'none' : '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
