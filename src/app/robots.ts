import type { MetadataRoute } from "next";

import { appOrigin } from "@/lib/config";

/*
 * Resolved per request, not at build time.
 *
 * As a static route this baked in whatever origin happened to be set when the
 * build ran — which locally is localhost, so a production bundle built without
 * the env var would advertise a sitemap on the reader's own machine. That is
 * the same failure as the og:image one, just slower to notice. These are two
 * tiny text responses fetched by crawlers; resolving them live costs nothing
 * worth measuring.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = appOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/book"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
