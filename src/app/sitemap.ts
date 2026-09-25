import type { MetadataRoute } from "next";

import { appOrigin } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appOrigin();
  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
