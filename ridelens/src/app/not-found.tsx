import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 400 }}>
        <p className="eyebrow">404</p>
        <h1
          className="display"
          style={{ marginTop: 6, fontSize: 'var(--t-xl)', letterSpacing: '-0.025em' }}
        >
          Nothing here
        </h1>
        <p
          style={{
            marginTop: 8,
            fontSize: 'var(--t-base)',
            color: 'var(--text-2)',
            lineHeight: 1.55,
          }}
        >
          That page does not exist. Share links expire after 30 days, so an old one may simply have
          aged out.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            marginTop: 18,
            minHeight: 44,
            padding: '0 18px',
            fontSize: 'var(--t-base)',
            fontWeight: 640,
            color: 'var(--on-inverse)',
            background: 'var(--surface-inverse)',
            borderRadius: 'var(--r-md)',
            textDecoration: 'none',
          }}
        >
          Compare a ride
        </Link>
      </div>
    </main>
  );
}
