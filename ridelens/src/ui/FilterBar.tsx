'use client';

/**
 * Category filter and sort order.
 *
 * Every colour and size here is a token. It previously reached for
 * `--text-secondary`, `--text-tertiary` and `--surface-raised`, none of which
 * exist in the stylesheet — the palette uses `--text-2`, `--text-3` and
 * `--surface`. An undefined custom property does not fall back to anything
 * sensible; it inherits, so an unselected pill quietly took whatever colour its
 * parent happened to have and a "raised" surface was transparent. That is the
 * kind of defect that looks like sloppy design rather than a bug, which is
 * exactly why it survived.
 *
 * Both rows are 34px tall and share a pill radius, so the two lines read as one
 * control group rather than two unrelated strips.
 */
import type { RankMode, ResultFilter } from '@/domain/ranking';

interface Props {
  filter: ResultFilter;
  onFilter: (f: ResultFilter) => void;
  mode: RankMode;
  onMode: (m: RankMode) => void;
  counts: Partial<Record<ResultFilter, number>>;
}

const FILTERS: Array<{ id: ResultFilter; label: string }> = [
  { id: 'BEST', label: 'Best' },
  { id: 'STANDARD', label: 'Standard' },
  { id: 'XL', label: 'XL' },
  { id: 'PREMIUM', label: 'Premium' },
  { id: 'TAXI', label: 'Taxi' },
  { id: 'ALL', label: 'All' },
];

const MODES: Array<{ id: RankMode; label: string }> = [
  { id: 'CHEAPEST', label: 'Cheapest' },
  { id: 'FASTEST', label: 'Fastest pickup' },
  { id: 'BEST_VALUE', label: 'Best value' },
];

const PILL_HEIGHT = 34;

export function FilterBar({ filter, onFilter, mode, onMode, counts }: Props) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <div
        role="tablist"
        aria-label="Ride category"
        className="rl-filter-scroll"
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          overflowX: 'auto',
          paddingBottom: 'var(--sp-05)',
        }}
      >
        {FILTERS.map((f) => {
          const count = counts[f.id];
          const selected = filter === f.id;
          const empty = count === 0;
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={selected}
              data-testid={`filter-${f.id}`}
              disabled={empty}
              onClick={() => onFilter(f.id)}
              className="rl-press"
              style={{
                flex: '0 0 auto',
                height: PILL_HEIGHT,
                padding: '0 var(--sp-3)',
                fontSize: 'var(--t-base)',
                fontWeight: selected ? 620 : 520,
                fontFamily: 'var(--font-sans)',
                color: empty ? 'var(--text-4)' : selected ? 'var(--on-inverse)' : 'var(--text-2)',
                background: selected ? 'var(--surface-inverse)' : 'var(--surface)',
                border: `1px solid ${selected ? 'var(--surface-inverse)' : 'var(--border)'}`,
                borderRadius: 'var(--r-full)',
                cursor: empty ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                opacity: empty ? 0.55 : 1,
              }}
            >
              {f.label}
              {typeof count === 'number' && count > 0 && (
                <span
                  className="tnum"
                  style={{
                    marginLeft: 'var(--sp-1)',
                    fontSize: 'var(--t-sm)',
                    // Not `opacity`: at 0.65 over a white pill this landed on
                    // #8b929b, which is 3.14:1 and fails AA. `currentColor` at
                    // 70% keeps the count subordinate on the selected pill,
                    // where the background is dark enough to carry it.
                    color: selected
                      ? 'color-mix(in srgb, currentColor 72%, transparent)'
                      : 'var(--text-3)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Scrolls rather than wraps, exactly like the row above it. At 360px
          "Best value" was dropping to a line of its own, which made two related
          controls read as two unrelated rows. */}
      <div
        className="rl-filter-scroll"
        style={{
          display: 'flex',
          gap: 'var(--sp-1)',
          alignItems: 'center',
          overflowX: 'auto',
          paddingBottom: 'var(--sp-05)',
        }}
      >
        <span
          className="eyebrow"
          style={{
            // Matches the pill height so the label sits on their centre line
            // rather than floating above it.
            display: 'inline-flex',
            alignItems: 'center',
            flex: '0 0 auto',
            height: PILL_HEIGHT,
            paddingRight: 'var(--sp-2)',
          }}
        >
          Sort
        </span>
        {MODES.map((m) => (
          <button
            key={m.id}
            data-testid={`mode-${m.id}`}
            aria-pressed={mode === m.id}
            onClick={() => onMode(m.id)}
            className="rl-press"
            style={{
              height: PILL_HEIGHT,
              padding: '0 var(--sp-3)',
              fontSize: 'var(--t-base)',
              fontWeight: mode === m.id ? 640 : 520,
              fontFamily: 'var(--font-sans)',
              color: mode === m.id ? 'var(--text)' : 'var(--text-2)',
              background: mode === m.id ? 'var(--surface)' : 'transparent',
              border: `1px solid ${mode === m.id ? 'var(--border-strong)' : 'transparent'}`,
              borderRadius: 'var(--r-full)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
