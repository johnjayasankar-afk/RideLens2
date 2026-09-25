'use client';

/**
 * Route-level error boundary.
 *
 * A render failure must not blank the page. It also must not be mistaken for a
 * pricing failure — the copy is explicit that nothing shown was a price, so a
 * rider never walks away thinking a provider was expensive when the truth was
 * that RideLens broke.
 */
import Link from 'next/link';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest correlates with the server log; the message itself is not
    // shown, since it can carry internals.
    console.error('RideLens render error', error.digest ?? '(no digest)');
  }, [error]);

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 440,
          padding: '26px 24px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--e-2)',
        }}
      >
        <p className="eyebrow" style={{ color: 'var(--danger)' }}>
          Something broke
        </p>
        <h1
          className="display"
          style={{ marginTop: 6, fontSize: 'var(--t-xl)', letterSpacing: '-0.025em' }}
        >
          RideLens hit an error
        </h1>
        <p
          style={{
            marginTop: 9,
            fontSize: 'var(--t-base)',
            lineHeight: 1.55,
            color: 'var(--text-2)',
          }}
        >
          This is a fault in RideLens, not a price from any provider. Nothing on the previous screen
          should be treated as a fare.
        </p>
        {error.digest && (
          <p
            className="mono"
            style={{ marginTop: 10, fontSize: 'var(--t-xs)', color: 'var(--text-4)' }}
          >
            Reference {error.digest}
          </p>
        )}
        <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              flex: 1,
              minHeight: 44,
              fontSize: 'var(--t-base)',
              fontWeight: 640,
              color: 'var(--on-inverse)',
              background: 'var(--surface-inverse)',
              border: '1px solid var(--surface-inverse)',
              borderRadius: 'var(--r-md)',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <Link
            href="/"
            style={{
              flex: '0 0 auto',
              minHeight: 44,
              display: 'grid',
              placeItems: 'center',
              padding: '0 16px',
              fontSize: 'var(--t-base)',
              fontWeight: 570,
              color: 'var(--text-2)',
              textDecoration: 'none',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r-md)',
            }}
          >
            Start over
          </Link>
        </div>
      </div>
    </main>
  );
}
