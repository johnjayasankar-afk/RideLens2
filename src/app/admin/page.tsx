import { timingSafeEqual } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { listAllSources, sourceStatusSummary } from "@/lib/sources/registry";
import { getUsageToday, listRecentSessions } from "@/lib/quotes/orchestrator";
import { getEnv, isProductionLiveCapable } from "@/lib/config";
import { cacheStats } from "@/lib/quotes/cache";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RideLens status",
  robots: { index: false, follow: false },
};

/** Name of the httpOnly cookie that holds an accepted admin secret. */
const ADMIN_COOKIE = "ridelens_admin";

/**
 * Compare without leaking length or position through timing.
 *
 * `a === b` on a secret returns as soon as two bytes differ, which is a
 * measurable signal. Lengths are compared first because timingSafeEqual throws
 * on a mismatch; that leaks the length alone, which is not the interesting part.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Take the secret from a POST body and put it in an httpOnly cookie.
 *
 * The page used to accept `?secret=…`, which writes the credential into the
 * access log of every proxy in front of it, into the browser's history, and
 * into the Referer header of every outbound link on the page.
 */
async function signIn(formData: FormData) {
  "use server";
  const env = getEnv();
  const expected = env.RIDELENS_ADMIN_SECRET;
  const provided = String(formData.get("secret") ?? "");
  if (!expected || !secretMatches(provided, expected)) redirect("/admin?denied=1");

  const jar = await cookies();
  jar.set(ADMIN_COOKIE, provided, {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
  redirect("/admin");
}

function unauthorized(denied: boolean) {
  return (
    <div className="shell status-shell">
      <div className="status-brand" aria-hidden>
        <span className="brand-mark" />
      </div>
      <p className="eyebrow">Admin</p>
      <h1 className="brand status-title">{denied ? "That secret was not accepted" : "Sign in"}</h1>
      <p className="muted status-copy">
        Set <code>RIDELENS_ADMIN_SECRET</code>, then enter it below. Automated callers may send the{" "}
        <code>x-admin-secret</code> header instead.
      </p>
      <form action={signIn} className="status-actions" style={{ gap: 8 }}>
        <input
          type="password"
          name="secret"
          aria-label="Admin secret"
          autoComplete="current-password"
          required
        />
        <button className="primary" type="submit">
          Sign in
        </button>
      </form>
      <div className="status-actions">
        <Link className="ghost" href="/">
          Back to comparison
        </Link>
      </div>
    </div>
  );
}

function healthTone(status: string): string {
  if (status === "healthy") return "is-ok";
  if (status === "degraded" || status === "misconfigured") return "is-warn";
  if (status === "disabled") return "is-muted";
  return "is-bad";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string; denied?: string }>;
}) {
  const env = getEnv();
  const secret = env.RIDELENS_ADMIN_SECRET;
  const params = await searchParams;
  const hdrs = await headers();
  const jar = await cookies();

  /*
   * A secret in the query string is already burned — it is in the browser
   * history and in this proxy's access log. Bounce it out of the URL rather
   * than honouring it, so a bookmarked or shared link stops working instead of
   * quietly continuing to authenticate.
   */
  if (params.secret) redirect("/admin");

  const provided = hdrs.get("x-admin-secret") || jar.get(ADMIN_COOKIE)?.value || "";

  // Matches the API's rule in /api/admin/overview: with no secret configured,
  // the dashboard is open outside production and closed inside it.
  const allowed = secret ? secretMatches(provided, secret) : env.NODE_ENV !== "production";

  if (!allowed) return unauthorized(params.denied === "1");

  const health = await Promise.all(
    listAllSources().map(async (s) => ({
      id: s.id,
      capabilities: s.capabilities(),
      health: await s.healthCheck(),
    })),
  );
  const usage = getUsageToday();
  const sessions = await listRecentSessions(12);
  const summary = sourceStatusSummary(env);
  const enabledCount = Object.values(summary).filter((v) => String(v).startsWith("enabled")).length;

  return (
    <div className="shell admin-shell">
      <div className="status-brand" aria-hidden>
        <span className="brand-mark" />
      </div>
      <p className="eyebrow">Internal</p>
      <h1 className="brand admin-title">RideLens status</h1>
      <p className="muted admin-lede">
        Source health, usage, and recent sessions: not a public accuracy claim.
      </p>

      <div className="admin-stats">
        <Stat label="Live capable" value={isProductionLiveCapable(env) ? "Yes" : "No"} />
        <Stat label="Comparisons today" value={String(usage.comparisons)} />
        <Stat label="Source calls" value={String(usage.sourceCalls)} />
        <Stat
          label="Avg latency"
          value={usage.avgLatencyMs == null ? "—" : `${usage.avgLatencyMs} ms`}
        />
        <Stat label="Cache entries" value={String(cacheStats().size)} />
        <Stat label="Enabled sources" value={String(enabledCount)} />
      </div>

      <h2 className="section-label">Sources</h2>
      <div className="admin-source-grid">
        {health.map((row) => (
          <article key={row.id} className="admin-source-card">
            <header className="admin-source-head">
              <strong>{row.id.replace(/_/g, " ")}</strong>
              <span className={`admin-pill ${healthTone(row.health.status)}`}>
                {row.health.status}
              </span>
            </header>
            <p className="muted admin-source-meta">
              {(row.health.providersSurfaced || []).join(", ") || "no providers"}
              {row.health.lastError ? ` · ${row.health.lastError}` : ""}
            </p>
          </article>
        ))}
      </div>

      <h2 className="section-label">Recent sessions</h2>
      <div className="admin-session-list">
        {sessions.length === 0 ? (
          <p className="muted">None yet</p>
        ) : (
          sessions.map((s) => (
            <article key={s.id} className="admin-session-card">
              <div className="admin-session-top">
                <code>{s.id.slice(0, 8)}</code>
                <span
                  className={`admin-pill ${s.status === "SUCCESS" ? "is-ok" : s.status === "PARTIAL" ? "is-warn" : "is-bad"}`}
                >
                  {s.status}
                </span>
              </div>
              <p className="muted">
                {s.quotes.length} quotes ·{" "}
                {s.coverage.providersReturned.join(", ") || "no providers"}
              </p>
            </article>
          ))
        )}
      </div>

      <p className="footer-links muted">
        <Link href="/">Back to comparison</Link>
      </p>
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
