import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { listAllSources, sourceStatusSummary } from "@/lib/sources/registry";
import { getUsageToday, listRecentSessions } from "@/lib/quotes/orchestrator";
import { getEnv, isProductionLiveCapable } from "@/lib/config";
import { cacheStats } from "@/lib/quotes/cache";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RideLens status",
  robots: { index: false, follow: false },
};

function unauthorized() {
  return (
    <div className="shell status-shell">
      <p className="eyebrow">Admin</p>
      <h1 className="brand status-title">Unauthorized</h1>
      <p className="muted status-copy">
        Set <code>RIDELENS_ADMIN_SECRET</code> and open{" "}
        <code>/admin?secret=…</code>, or send header{" "}
        <code>x-admin-secret</code>.
      </p>
      <div className="status-actions">
        <a className="ghost" href="/">
          Back to comparison
        </a>
      </div>
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>;
}) {
  const env = getEnv();
  const secret = env.RIDELENS_ADMIN_SECRET;
  const params = await searchParams;
  const hdrs = await headers();
  const jar = await cookies();

  const provided =
    params.secret ||
    hdrs.get("x-admin-secret") ||
    jar.get("ridelens_admin")?.value ||
    "";

  const allowed = secret
    ? provided === secret
    : env.NODE_ENV !== "production";

  if (!allowed) return unauthorized();

  const health = await Promise.all(
    listAllSources().map(async (s) => ({
      id: s.id,
      capabilities: s.capabilities(),
      health: await s.healthCheck(),
    })),
  );
  const usage = getUsageToday();
  const sessions = listRecentSessions(12);

  return (
    <div className="shell admin-shell">
      <p className="eyebrow">Internal</p>
      <h1 className="brand admin-title">RideLens status</h1>
      <p className="muted admin-lede">
        Source health, usage, and recent sessions — not a public accuracy claim.
      </p>

      <div className="admin-stats">
        <Stat
          label="Live capable"
          value={isProductionLiveCapable(env) ? "Yes" : "No"}
        />
        <Stat label="Comparisons today" value={String(usage.comparisons)} />
        <Stat label="Source calls" value={String(usage.sourceCalls)} />
        <Stat
          label="Avg latency"
          value={usage.avgLatencyMs == null ? "—" : `${usage.avgLatencyMs} ms`}
        />
        <Stat label="Cache entries" value={String(cacheStats().size)} />
      </div>

      <h2 className="section-label">Sources</h2>
      <pre className="admin-pre">
        {JSON.stringify({ summary: sourceStatusSummary(env), health }, null, 2)}
      </pre>

      <h2 className="section-label">Recent sessions</h2>
      <ul className="admin-sessions">
        {sessions.length === 0 ? <li className="muted">None yet</li> : null}
        {sessions.map((s) => (
          <li key={s.id}>
            <code>{s.id.slice(0, 8)}</code> — {s.status} — {s.quotes.length}{" "}
            quotes — {s.coverage.providersReturned.join(", ") || "no providers"}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-stat">
      <div className="muted admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
    </div>
  );
}
