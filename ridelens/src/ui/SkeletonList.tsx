'use client';

/**
 * Loading state.
 *
 * Skeletons are named per provider rather than anonymous grey blocks, so the
 * rider can see which providers are being asked while they wait — and notice
 * immediately if one is missing from the finished list.
 */
import { providerProfile } from '@/config/providers';
import type { ProviderId } from '@/domain/quote';
import { ProviderMark } from './ProviderMark';

export function SkeletonList({ providers }: { providers: ProviderId[] }) {
  const list =
    providers.length > 0 ? providers : (['uber', 'lyft', 'empower', 'curb'] as ProviderId[]);
  return (
    <div
      data-testid="skeletons"
      className="stagger"
      style={{ display: 'grid', gap: 'var(--sp-2)' }}
      aria-label="Fetching prices"
      aria-busy="true"
    >
      {list.map((p) => (
        <div
          key={p}
          className="enter"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) auto',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            padding: '13px 15px 13px 17px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
          }}
        >
          <div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <ProviderMark provider={p} size={22} dimmed />
              <span
                style={{
                  fontSize: 'var(--t-base)',
                  fontWeight: 620,
                  color: 'var(--text-3)',
                }}
              >
                {providerProfile(p).displayName}
              </span>
            </span>
            <div
              className="skeleton"
              style={{ height: 25, width: 104, marginTop: 'var(--sp-2)' }}
            />
            <div
              className="skeleton"
              style={{ height: 10, width: 146, marginTop: 'var(--sp-2)' }}
            />
          </div>
          <div
            className="skeleton"
            style={{ height: 44, width: 118, borderRadius: 'var(--r-md)' }}
          />
        </div>
      ))}
    </div>
  );
}
