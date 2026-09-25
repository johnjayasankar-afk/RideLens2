"use client";

/* RideLens, in the Labs material.
 *
 * Glass on the top bar and the quote cards, flat glass on the filter chips. A
 * client component so it runs in the browser only; the module itself is written
 * so that importing it on the server does nothing at all.
 *
 * The app renders results as they arrive, so labs-ui watches for new nodes.
 */
import { useEffect } from "react";
// labs-ui is plain JavaScript, shared across every Labs product
import { initLabsUI } from "../lib/labs-ui.js";

export function LabsUI() {
  useEffect(() => {
    const ui = initLabsUI({
      observe: true,
      glass: [
        {
          sel: ".topbar",
          spec: 1,
          lens: [13, 52, 9, 1.95],
          vars: { "--gl-tint": ".5", "--gl-drop": "0 1px 0 rgba(28,51,38,.09)" },
        },
        { sel: ".quote-card", lens: [12, 34, 8, 1.7], vars: { "--gl-tint": ".66" } },
        { sel: ".chip", flat: 1, vars: { "--gl-tint": ".5" } },
      ],
      headings: "h1, h2",
    });
    return () => ui.stop?.();
  }, []);
  return null;
}
