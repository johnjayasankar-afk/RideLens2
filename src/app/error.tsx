"use client";

import Link from "next/link";

/**
 * A page that threw, rendered inside the layout that survived.
 *
 * If the layout itself is what threw, this never runs — `global-error.tsx`
 * does, and replaces the whole document.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="shell status-shell">
      <div className="status-brand" aria-hidden>
        <span className="brand-mark" />
      </div>
      <p className="eyebrow">Something went wrong</p>
      <h1 className="brand status-title">We hit a bump</h1>
      <p className="muted status-copy">
        RideLens couldn’t finish that request. Try again, or head back to the comparison.
      </p>
      <div className="status-actions">
        <button type="button" className="primary" onClick={reset}>
          Try again
        </button>
        <Link className="ghost" href="/">
          Back to comparison
        </Link>
      </div>
      {/*
        A hash, not a message, so it leaks nothing — and the only thing that
        lets somebody reporting this be matched to the server log that
        explains it.
      */}
      {error.digest ? (
        <p className="muted fine status-digest">
          If you report this, quote <code className="mono">{error.digest}</code>.
        </p>
      ) : null}
    </div>
  );
}
