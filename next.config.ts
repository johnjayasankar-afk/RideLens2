import type { NextConfig } from "next";
import { FRAMING_CSP } from "./src/lib/embed";

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
  FRAMING_CSP,
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
          // No X-Frame-Options: SAMEORIGIN would block the portfolio's live
          // preview on its own, whatever the CSP says, because the policy
          // below is report-only and a report-only policy overrides nothing.
          { key: "Content-Security-Policy", value: FRAMING_CSP },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=()" },
          { key: "Content-Security-Policy-Report-Only", value: CSP },
        ],
      },
      {
        /*
         * The handoff page links straight out to provider domains, so it is
         * the one place a Referer could carry anything about the trip. The
         * site-wide policy already trims cross-origin referrers to the origin;
         * this sends none at all, because a provider has no reason to learn
         * even that a rider arrived from /book.
         */
        source: "/book",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
