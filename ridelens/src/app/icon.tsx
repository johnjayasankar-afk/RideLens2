import { ImageResponse } from 'next/og';

/**
 * App icon: the same lens-over-a-route mark as `ui/Brand.tsx`, on the same
 * 32-unit grid. Generated rather than shipped as a binary so it stays in
 * version control as readable source — and so it cannot drift from the header.
 */
export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#10151d',
          borderRadius: 14,
        }}
      >
        <svg width="52" height="52" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="9.1" stroke="#f4f7fa" strokeWidth="2.1" />
          <path d="M7.4 22.6 L24.6 9.4" stroke="#2ecf94" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="7.4" cy="22.6" r="2.5" fill="#2ecf94" />
          <circle cx="24.6" cy="9.4" r="2.5" fill="#2ecf94" />
          <circle cx="16" cy="16" r="3.5" fill="#10151d" />
          <circle cx="16" cy="16" r="2.1" fill="#f4f7fa" />
        </svg>
      </div>
    ),
    size,
  );
}
