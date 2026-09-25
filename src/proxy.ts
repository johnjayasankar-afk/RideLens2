/**
 * A content policy that actually enforces, with a nonce instead of a blanket
 * `'unsafe-inline'`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The policy used to live in next.config.ts and ship report-only, with a   │
 * │ comment saying to flip it "once the console is quiet". Nobody had        │
 * │ checked: a single comparison produced 219 violations, because MapLibre   │
 * │ fetches its style, tiles, sprite and glyph fonts over XHR — all          │
 * │ connect-src — and runs its decoder in a blob worker. Enforcing it would  │
 * │ have blanked the map.                                                    │
 * │                                                                          │
 * │ Those directives are fixed and the console is now genuinely quiet, so    │
 * │ the policy enforces. And a policy worth enforcing does not carry         │
 * │ 'unsafe-inline' on script-src, which is why this moved here: a nonce has │
 * │ to be generated per request, and next.config.ts headers are static.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Next.js finds the nonce by parsing the Content-Security-Policy on the
 * *request* headers and applies it to its own framework scripts, bundles and
 * inline styles. That is why it is set on both the request and the response.
 *
 * A nonce requires dynamic rendering — a page prerendered at build time has
 * no request to draw one from. The matcher therefore skips static assets, and
 * `style-src` keeps 'unsafe-inline' because React inline styles cannot carry
 * one.
 */
import { NextResponse, type NextRequest } from "next/server";

import { FRAMING_CSP } from "@/lib/embed";

/**
 * Hosts the app genuinely talks to, verified against a real page load rather
 * than assembled from memory. Note there is no script host: MapLibre is a
 * bundled dependency and its worker is served from here, so nothing external
 * executes. See docs/SECURITY.md.
 */
const ROUTING = ["https://router.project-osrm.org", "https://routing.openstreetmap.de"];
const GEOCODING = ["https://nominatim.openstreetmap.org"];
const WEATHER = ["https://api.open-meteo.com"];
/*
 * Both spellings: a wildcard does not match the bare domain, and the map
 * style lives on the bare domain while the tiles are on tiles-a/b/c/d.
 */
const BASEMAP = ["https://basemaps.cartocdn.com", "https://*.basemaps.cartocdn.com"];
function policy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    /*
     * No 'unsafe-inline'. Next's inline bootstrap carries the nonce, and
     * 'strict-dynamic' is deliberately absent: it would tell browsers to
     * ignore 'self', and any page served from a static prerender has no
     * nonce to offer, so its own bundles would be refused.
     *
     * 'unsafe-eval' in development only — React uses eval to rebuild server
     * error stacks in the browser, and neither React nor Next use it in a
     * production build.
     */
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
    // React sets inline styles directly on elements, which a nonce cannot cover.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://api.mapbox.com",
    "font-src 'self'",
    // MapLibre pulls style, tiles, sprite and glyph .pbf files over XHR.
    `connect-src 'self' ${[...ROUTING, ...GEOCODING, ...WEATHER, ...BASEMAP].join(" ")}`,
    // MapLibre decodes tiles in a blob worker.
    "worker-src 'self' blob:",
    "frame-src https://m.uber.com https://www.lyft.com https://www.rideempower.com https://gocurb.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    FRAMING_CSP,
    // Meaningless while report-only; meaningful now that this enforces.
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = policy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next parses this to find the nonce and apply it to its own scripts.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      /*
       * HTML only. API routes render no markup and serve no scripts, static
       * chunks are already covered by the policy on the page that loads them,
       * and a prefetch is not a document.
       */
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
