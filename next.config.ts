import type { NextConfig } from "next";
import { FRAMING_CSP } from "./src/lib/embed";

/* The security headers the Labs family sends.
 *
 * The content policy is NOT here. It needs a per-request nonce, which a
 * static header table cannot produce, so it lives in src/proxy.ts and
 * enforces. What remains are the headers that are the same on every
 * response.
 *
 * FRAMING_CSP stays duplicated here on purpose: the proxy does not run for
 * API routes or static assets, and frame-ancestors is the one directive that
 * must hold everywhere for the portfolio embed to work and for nothing else
 * to frame this app.
 */
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
