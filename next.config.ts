import type { NextConfig } from "next";

/* The security headers the Labs family sends.
 *
 * The content policy ships in report-only mode on purpose: this app talks to a
 * map tile host, a routing host and a geocoder, and a policy that is wrong
 * breaks the map rather than the page. Report-only lets the real traffic prove
 * the list is complete; once the console is quiet, rename the header to
 * Content-Security-Policy and it starts enforcing.
 */
const CSP = [
  "default-src 'self'",
  // Next.js hydrates through an inline script
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://api.mapbox.com",
  "font-src 'self'",
  "connect-src 'self' https://router.project-osrm.org https://routing.openstreetmap.de https://nominatim.openstreetmap.org https://api.open-meteo.com",
  "frame-src https://m.uber.com https://www.lyft.com https://www.rideempower.com https://gocurb.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // upgrade-insecure-requests belongs here only once the header is enforcing:
  // a report-only policy ignores it, and says so in the console.
].join("; ");

const nextConfig: NextConfig = {
  typedRoutes: true,
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=()" },
          { key: "Content-Security-Policy-Report-Only", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
