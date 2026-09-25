import type { NextConfig } from 'next';

/**
 * Security headers. RideLens renders no third-party HTML and fetches provider
 * data exclusively server-side, so the browser CSP can stay tight.
 *
 * The one relaxation is development-only and non-negotiable there: React's dev
 * build uses eval() for callstack reconstruction, and Next's HMR needs a
 * WebSocket. Without them client components never hydrate and the app is inert.
 * PRODUCTION KEEPS THE STRICT POLICY — no 'unsafe-eval', no ws:.
 */
const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  // MapLibre compiles shaders and workers from blob: URLs.
  `script-src 'self' 'unsafe-inline' blob:${isDev ? " 'unsafe-eval'" : ''}`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  // OSM raster tiles for the route map.
  // A CSP wildcard requires a label before the matched name, so
  // `*.tile.openstreetmap.org` does NOT match the apex `tile.openstreetmap.org`
  // that MapLibre actually requests. Both forms are listed deliberately.
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  `connect-src 'self' https://tile.openstreetmap.org https://*.tile.openstreetmap.org${isDev ? ' ws: http://127.0.0.1:* http://localhost:*' : ''}`,
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * Next's dev server refuses to serve client assets to an origin it does not
   * recognise, which silently prevents hydration. Playwright and local browsing
   * both use 127.0.0.1, so both are listed. Development only — `next build`
   * ignores this field.
   */
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            // Geolocation is the one sensitive capability we do use, self-only.
            value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
