/**
 * A state change the reader caused, tweened where the browser can.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ globals.css has styled `::view-transition-old(root)` and                 │
 * │ `::view-transition-new(root)` since the ranking controls were built, and │
 * │ for most of that time the only caller was the re-sort — so the rule sat  │
 * │ there for the one change it was least needed on, and the biggest cut in  │
 * │ the app, the porcelain-to-forest theme flip, was a hard swap across the  │
 * │ whole viewport including the map.                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Feature-detected rather than assumed, and skipped when the reader has asked
 * for less motion — in both cases the update happens exactly as it did
 * before, just without the tween. It is never used for anything that is not a
 * direct consequence of something the reader did: a transition on an arriving
 * price would be the interface implying the number travelled from somewhere.
 */
export function withTransition(run: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  const wants =
    typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (wants && typeof doc.startViewTransition === "function") {
    /*
     * The promise is caught, not discarded.
     *
     * A view transition rejects rather than throws when it cannot run — two
     * elements sharing a `view-transition-name`, or a second transition
     * starting while one is in flight. The DOM update still applies either
     * way, so there is nothing to recover from and nothing to tell the
     * reader; but an uncaught rejection is an error every reporter will
     * collect, for a tween that was optional to begin with.
     */
    const t = doc.startViewTransition(run) as { finished?: Promise<unknown> } | undefined;
    void t?.finished?.catch(() => {
      /* The update ran. Only the animation was skipped. */
    });
    return;
  }
  run();
}
