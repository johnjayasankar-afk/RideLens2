"use client";

export default function Error({
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
        <a className="ghost" href="/">
          Back to comparison
        </a>
      </div>
    </div>
  );
}
