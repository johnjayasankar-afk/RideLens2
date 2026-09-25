/*
 * Dynamic for the same reason as /book: a prerendered page cannot carry the
 * nonce that src/proxy.ts puts in the content policy, so its scripts are
 * refused and it never hydrates.
 */
export const dynamic = "force-dynamic";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell status-shell">
      <div className="status-brand" aria-hidden>
        <span className="brand-mark" />
      </div>
      <p className="eyebrow">404</p>
      <h1 className="brand status-title">Page not found</h1>
      <p className="muted status-copy">
        That route doesn’t exist. Jump back to RideLens and compare your ride.
      </p>
      <div className="status-actions">
        <Link className="primary" href="/">
          Back to comparison
        </Link>
      </div>
    </div>
  );
}
