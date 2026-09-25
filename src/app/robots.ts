import type { MetadataRoute } from "next";

import { appOrigin } from "@/lib/config";

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
