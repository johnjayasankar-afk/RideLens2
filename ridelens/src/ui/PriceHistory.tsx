'use client';

/**
 * Price movement across this screen's refreshes.
 *
 * Scoped to the session deliberately: RideLens keeps no long-term price
 * analytics, and a fare from yesterday is not a fare. What this answers is the
 * question a rider actually has while deciding — "is it going up while I sit
 * here?"
 *
 * The sparkline is drawn from real observations only; a single point stays a
 * single point rather than being extrapolated into a trend.
 */
import { providerProfile } from '@/config/providers';
import { formatMoney } from '@/domain/money';
import type { HistoryPoint } from './useCompareSession';

export function PriceHistory({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) return null;

  const values = history.map((h) => h.cheapestMinor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const first = history[0] as HistoryPoint;
  const last = history[history.length - 1] as HistoryPoint;
  const change = last.cheapestMinor - first.cheapestMinor;

  const W = 100;
  const H = 26;
  const points = history
    .map((h, i) => {
      const x = (i / (history.length - 1)) * W;
      const y = H - ((h.cheapestMinor - min) / span) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const tone = change > 0 ? 'var(--danger)' : change < 0 ? 'var(--best)' : 'var(--text-3)';

  return (
    <section
      data-testid="price-history"
      aria-label="Cheapest price across refreshes"
      style={{
        padding: '11px 13px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--sp-2)',
        }}
      >
        <h2 className="eyebrow">Cheapest, this session</h2>
        <span className="tnum" style={{ fontSize: 'var(--t-xs)', color: tone, fontWeight: 620 }}>
          {change === 0
            ? 'unchanged'
            : `${change > 0 ? '↑' : '↓'} ${formatMoney(Math.abs(change), last.currency)}`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Cheapest price moved from ${formatMoney(first.cheapestMinor, first.currency)} to ${formatMoney(last.cheapestMinor, last.currency)} over ${history.length} refreshes`}
        style={{ width: '100%', height: 30, marginTop: 'var(--sp-2)', overflow: 'visible' }}
      >
        <polyline
          points={points}
          fill="none"
          stroke={tone}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {history.map((h, i) => {
          const x = (i / (history.length - 1)) * W;
          const y = H - ((h.cheapestMinor - min) / span) * H;
          const isLast = i === history.length - 1;
          return (
            <circle
              key={h.at}
              cx={x}
              cy={y}
              r={isLast ? 2.6 : 1.6}
              fill={isLast ? tone : 'var(--surface)'}
              stroke={tone}
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      <p
        className="tnum"
        style={{
          marginTop: 'var(--sp-15)',
          fontSize: 'var(--t-xs)',
          color: 'var(--text-3)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 'var(--sp-2)',
        }}
      >
        <span>{formatMoney(first.cheapestMinor, first.currency)}</span>
        <span style={{ color: 'var(--text-2)' }}>
          now {formatMoney(last.cheapestMinor, last.currency)} ·{' '}
          {providerProfile(last.provider).displayName}
        </span>
      </p>
    </section>
  );
}
