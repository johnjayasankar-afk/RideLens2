'use client';

/**
 * Source failure reporting.
 *
 * Errors are localised: a Curb outage shows as one line about Curb while every
 * other provider renders normally. A failed source NEVER falls back to a stale
 * or invented number — the honest statement is that we do not have that price.
 *
 * Collapsed by default once results exist, because a rider comparing fares
 * should not have to scroll past infrastructure news to reach them.
 */
import { useState } from 'react';
import { providerProfile } from '@/config/providers';
import type { ProviderId, SourceOutcome } from '@/domain/quote';
import { ProviderMark } from './ProviderMark';

const STATUS_COPY: Record<SourceOutcome['status'], string> = {
  OK: 'No result for this route',
  TIMEOUT: 'Timed out',
  ERROR: 'Temporarily unavailable',
  SKIPPED: 'Not enabled',
  UNAUTHORIZED: 'Access not authorized',
  RATE_LIMITED: 'Rate limited',
};

interface Props {
  outcomes: SourceOutcome[];
  providersBySource: Record<string, ProviderId[]>;
  /** Start expanded when there is nothing else on screen. */
  defaultOpen?: boolean;
}

export function SourceStatus({ outcomes, providersBySource, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  /**
   * A source that failed, and also one that succeeded but returned nothing and
   * left a reason. The second case matters: "no published taxi rate card for
   * this pickup, here is what is covered" is the most useful sentence on the
   * screen, and it would otherwise be hidden behind an OK status.
   */
  const problems = outcomes.filter(
    (o) => o.status !== 'OK' || (o.quoteCount === 0 && o.message !== null),
  );
  if (problems.length === 0) return null;

  const affected = Array.from(
    new Set(problems.flatMap((o) => providersBySource[o.sourceId] ?? [])),
  ) as ProviderId[];

  return (
    <section
      data-testid="source-status"
      aria-label="Source availability"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="source-status-toggle"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          padding: '11px 13px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', gap: -4 }}>
          {affected.slice(0, 4).map((p) => (
            <span key={p} style={{ marginRight: -6 }}>
              <ProviderMark provider={p} size={20} dimmed />
            </span>
          ))}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: 'var(--t-sm)',
              fontWeight: 620,
              color: 'var(--text-2)',
            }}
          >
            {problems.length === 1
              ? '1 source returned no price'
              : `${problems.length} sources returned no price`}
          </span>
          <span style={{ display: 'block', fontSize: 'var(--t-xs)', color: 'var(--text-3)' }}>
            Nothing is estimated on their behalf
          </span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--d-fast) var(--ease)',
            color: 'var(--text-3)',
          }}
        >
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          style={{
            margin: 0,
            padding: '0 13px 12px',
            listStyle: 'none',
            display: 'grid',
            gap: 'var(--sp-2)',
          }}
        >
          {problems.map((o) => {
            const providers = providersBySource[o.sourceId] ?? [];
            const names = providers.map((p) => providerProfile(p).displayName).join(', ');
            return (
              <li
                key={o.sourceId}
                data-testid="source-problem"
                data-source={o.sourceId}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  alignItems: 'flex-start',
                  fontSize: 'var(--t-sm)',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 'var(--r-full)',
                    marginTop: 'var(--sp-15)',
                    flex: '0 0 auto',
                    background:
                      o.status === 'SKIPPED' || o.status === 'OK' ? 'var(--text-4)' : 'var(--warn)',
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontWeight: 630 }}>{names || o.sourceId}</strong>
                  <span style={{ color: 'var(--text-2)' }}> — {STATUS_COPY[o.status]}</span>
                  {o.message && (
                    <span
                      style={{
                        display: 'block',
                        color: 'var(--text-3)',
                        fontSize: 'var(--t-xs)',
                        marginTop: 'var(--sp-05)',
                        lineHeight: 1.5,
                      }}
                    >
                      {o.message}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
