import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RideLens",
    short_name: "RideLens",
    description:
      "Compare Uber, Lyft, Empower, and Curb before you book — live routing and tight fare estimates.",
    start_url: "/",
    display: "standalone",
    background_color: "#070a0e",
    theme_color: "#070a0e",
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
