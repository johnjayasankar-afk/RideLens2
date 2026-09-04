import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell status-shell">
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
