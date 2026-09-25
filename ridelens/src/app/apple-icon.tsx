import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
        }}
      >
        <svg width="112" height="112" viewBox="0 0 32 32" fill="none">
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
