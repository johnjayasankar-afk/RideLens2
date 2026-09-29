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
         * The topbar is not dressed here any more.
         *
         * `.gl--flat` sets `background-color: rgba(var(--gl-rgb), var(--gl-tint))`
         * and labs-glass loads after globals.css, so this line — six characters
         * of it — was overriding the bar's own `rgba(var(--scrim-rgb), 0.96)`
         * with a **50% tint**. `.gl--flat` carries no backdrop-filter by
         * design, so that is a half-transparent sticky header with nothing
         * behind it: measured, `getComputedStyle(.topbar).backgroundColor` was
         * `rgba(11, 26, 19, 0.5)`. On a phone "Commands ⌘K" and "Clear route"
         * read straight through the wordmark. It is the first thing anyone
         * sees, it is on every screen, and it had been that way silently
         * because the app's own rule never applied.
         *
         * Two more artefacts went with it. `.gl--spec`'s resting sheen is a
         * `radial-gradient(240px circle at var(--gx, 50%) var(--gy, -10%))`,
         * and 50% of 1440 is 720 — the "blotchy two-lobe wash peaking at x=720
         * with a dead right half" is the pointer highlight parked at its
         * default. And `.gl--flat`'s rim is `inset 1.6px 1.6px 0 -0.7px
         * rgba(255, 255, 255, 1)`, pure white at full alpha, which drew a 1px
         * L*45 column down the viewport's left edge and stopped at y=60.
         *
         * The bar's material is in globals.css now, where it is deterministic
         * and where the app can decide what its most-seen 60px look like.
         */
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
