import { ImageResponse } from 'next/og';

/**
 * Share card. States what RideLens is, and — deliberately — shows no prices:
 * a fare baked into a social preview would be stale the moment it was rendered.
 */
export const alt = 'RideLens — Every ride. One live comparison.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0b0e13',
          padding: 72,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <svg width="56" height="56" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="9.1" stroke="#f4f7fa" strokeWidth="2.1" />
            <path
              d="M7.4 22.6 L24.6 9.4"
              stroke="#2ecf94"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <circle cx="7.4" cy="22.6" r="2.5" fill="#2ecf94" />
            <circle cx="24.6" cy="9.4" r="2.5" fill="#2ecf94" />
            <circle cx="16" cy="16" r="3.5" fill="#10151d" />
            <circle cx="16" cy="16" r="2.1" fill="#f4f7fa" />
          </svg>
          <div
            style={{ color: '#edf1f6', fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em' }}
          >
            RideLens
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              color: '#ffffff',
              fontSize: 78,
              fontWeight: 700,
              letterSpacing: '-0.04em',
              lineHeight: 1.05,
            }}
          >
            Every ride.
          </div>
          <div
            style={{
              color: '#34d399',
              fontSize: 78,
              fontWeight: 700,
              letterSpacing: '-0.04em',
              lineHeight: 1.05,
            }}
          >
            One live comparison.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          {['Uber', 'Lyft', 'Empower', 'Curb'].map((name) => (
            <div
              key={name}
              style={{
                display: 'flex',
                padding: '10px 20px',
                borderRadius: 999,
                border: '1px solid #2f3641',
                color: '#a4aebc',
                fontSize: 24,
              }}
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
