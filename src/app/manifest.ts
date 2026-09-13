import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RideLens",
    short_name: "RideLens",
    description:
      "Compare Uber, Lyft, Empower, and Curb before you book — live routing and tight fare estimates.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f6f1",
    theme_color: "#f8f6f1",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
