"use client";

import { useEffect } from "react";

import { announceEmbed } from "@/lib/embed";

/**
 * Renders nothing. Tells a page that framed this one that it actually rendered,
 * so that page can reveal the frame instead of leaving a still up. A frame the
 * browser blocked never runs this, which is the point: it is the only signal
 * the embedding page can trust. See src/lib/embed.ts.
 */
export function EmbedAnnounce() {
  useEffect(() => {
    announceEmbed();
  }, []);
  return null;
}
