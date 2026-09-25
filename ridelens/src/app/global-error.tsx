'use client';

/**
 * Last-resort boundary: the root layout itself failed, so this renders its own
 * <html>. Deliberately dependency-free and inline-styled — anything it imports
 * could be the thing that is broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
          background: '#f6f8fa',
          color: '#141920',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'left' }}>
          <h1 style={{ fontSize: 22, margin: 0, letterSpacing: '-0.02em' }}>RideLens is down</h1>
          <p style={{ marginTop: 10, lineHeight: 1.55, color: '#4d5765', fontSize: 14 }}>
            The application failed to start. Nothing shown before this was a price.
          </p>
          {error.digest && (
            <p style={{ marginTop: 10, fontSize: 12, color: '#8e98a5' }}>
              Reference {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 18,
              minHeight: 44,
              padding: '0 18px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: '#141920',
              border: 'none',
              borderRadius: 11,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
