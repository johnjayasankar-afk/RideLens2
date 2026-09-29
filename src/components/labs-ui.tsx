"use client";

/* RideLens, in the Labs material.
 *
 * Flat glass on the top bar and the filter chips — the rim of light and the
 * pointer sheen, without a backdrop-filter. A client component so it runs in
 * the browser only; the module itself is written so that importing it on the
 * server does nothing at all.
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
        /*
         * Flat glass on the bar, and no lens.
         *
         * `.gl` is a backdrop-filter, and the topbar is sticky, full width and
         * on screen for every frame of every scroll — the most expensive
         * surface in the app measured by frames it appears in, spent blurring
         * a flat ground and a dot grid. `.gl--flat` keeps the rim of light and
         * the pointer sheen, which are what make it feel like a material, and
         * asks nothing of the compositor. `--gl-drop` went with it: it was a
         * light-palette literal that never inverted.
         */
        { sel: ".topbar", flat: 1, spec: 1, vars: { "--gl-tint": ".5" } },
        /*
         * The cards are not dressed any more, and were not really dressed
         * before: React rewrites `className` on every re-render, which strips
         * the class this adds, while the `data-gl-done` flag it leaves behind
         * stops it ever being re-applied. Measured live, `.quote-card` carried
         * no `gl` class and `backdrop-filter: none`. Their material is in
         * globals.css now, where it is deterministic.
         */
        { sel: ".chip", flat: 1, vars: { "--gl-tint": ".5" } },
      ],
      headings: "h1, h2",
    });
    return () => ui.stop?.();
  }, []);
  return null;
}
