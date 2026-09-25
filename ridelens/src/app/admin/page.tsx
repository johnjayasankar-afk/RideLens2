/**
 * Operator dashboard.
 *
 * Deliberately plain: the numbers an operator acts on, per source, and nothing
 * else. No vanity metrics, and no accuracy figure — there is no cross-check
 * dataset to evidence one, so publishing a percentage would be a claim rather
 * than a measurement.
 */
import { getConfig, startupChecks } from '@/config/env';
import { providerProfile } from '@/config/providers';
import { circuitBreaker, type CircuitState } from '@/orchestration/circuit';
import { ESTIMATED_COST_PER_CALL_USD_CENTS, metrics } from '@/observability/metrics';
import { allSources, enabledLiveSources } from '@/sources/registry';
import type { SourceHealth } from '@/sources/types';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Source health', robots: { index: false, follow: false } };

const STATUS_TONE: Record<string, string> = {
  HEALTHY: 'var(--best)',
  DEGRADED: 'var(--warn)',
  UNAVAILABLE: 'var(--danger)',
  NOT_CONFIGURED: 'var(--text-4)',
  BLOCKED_BY_POLICY: 'var(--warn)',
};

const CIRCUIT_TONE: Record<CircuitState, string> = {
  CLOSED: 'var(--best)',
  HALF_OPEN: 'var(--warn)',
  OPEN: 'var(--danger)',
};

export default async function AdminPage() {
  const cfg = getConfig();
  const sources = allSources();
  const health = await Promise.all(
    sources.map((s) =>
      s.healthCheck().catch(
        (): SourceHealth => ({
          sourceId: s.capabilities().sourceId,
          status: 'UNAVAILABLE',
          detail: 'Health check threw.',
          checkedAt: new Date().toISOString(),
          latencyMs: null,
          blockerCode: null,
        }),
      ),
    ),
  );

  const snapshot = metrics.snapshot();
  const circuits = new Map(circuitBreaker.snapshot().map((c) => [c.sourceId, c]));
  const live = enabledLiveSources();
  const checks = startupChecks(cfg, live.length);
  const errors = checks.filter((c) => c.level === 'error');

  const estimatedCostMinor = snapshot.sources.reduce(
    (sum, s) => sum + s.calls * (ESTIMATED_COST_PER_CALL_USD_CENTS[s.sourceId] ?? 0),
    0,
  );

  return (
    <main
      style={{
        maxWidth: 1040,
        margin: '0 auto',
        padding: '26px 18px 64px',
        display: 'grid',
        gap: 20,
      }}
    >
      <header>
        <p className="eyebrow">RideLens operations</p>
        <h1
          className="display"
          style={{ marginTop: 4, fontSize: 'var(--t-xl)', letterSpacing: '-0.03em' }}
        >
          Source health
        </h1>
        <p
          className="mono"
          style={{ marginTop: 6, fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}
        >
          {cfg.NODE_ENV} · geocoder {cfg.geocoderProvider} · persistence {cfg.persistence} · limiter{' '}
          {cfg.rateLimiter}
        </p>
      </header>

      {/* The single question an operator opens this page to answer. */}
      <section
        style={{
          padding: '15px 17px',
          borderRadius: 'var(--r-lg)',
          border: `1px solid ${live.length > 0 ? 'var(--best-line)' : 'var(--warn-line)'}`,
          background: live.length > 0 ? 'var(--best-soft)' : 'var(--warn-soft)',
        }}
      >
        <p
          className="display"
          style={{
            fontSize: 'var(--t-lg)',
            color: live.length > 0 ? 'var(--best)' : 'var(--warn)',
          }}
        >
          {live.length > 0
            ? `Live data available from ${live.length} source${live.length === 1 ? '' : 's'}`
            : 'No live quote source connected'}
        </p>
        <p
          style={{ marginTop: 4, fontSize: 'var(--t-sm)', color: 'var(--text-2)', lineHeight: 1.5 }}
        >
          {live.length > 0
            ? live.map((s) => s.capabilities().displayName).join(', ')
            : 'Every provider is reported unavailable rather than priced. See SETUP_REQUIRED.md.'}
        </p>
      </section>

      {checks.length > 0 && (
        <section style={{ display: 'grid', gap: 7 }}>
          {checks.map((c) => (
            <p
              key={c.code}
              style={{
                margin: 0,
                padding: '10px 12px',
                fontSize: 'var(--t-sm)',
                lineHeight: 1.5,
                borderRadius: 'var(--r-md)',
                color: c.level === 'error' ? 'var(--danger)' : 'var(--warn)',
                background: c.level === 'error' ? 'var(--danger-soft)' : 'var(--warn-soft)',
                border: `1px solid ${c.level === 'error' ? 'var(--danger-line)' : 'var(--warn-line)'}`,
              }}
            >
              <strong className="mono">{c.code}</strong> — {c.message}
            </p>
          ))}
        </section>
      )}

      <section style={{ display: 'grid', gap: 9 }}>
        <h2 className="eyebrow">Sources</h2>
        {sources.map((s, i) => {
          const caps = s.capabilities();
          const gate = s.enablement();
          const h = health[i];
          const m = snapshot.sources.find((x) => x.sourceId === caps.sourceId);
          const circuit = circuits.get(caps.sourceId);

          return (
            <article
              key={caps.sourceId}
              style={{
                padding: '14px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                boxShadow: 'var(--e-1)',
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 'var(--t-md)', fontWeight: 650 }}>
                  {caps.displayName}
                </strong>
                <Pill tone={STATUS_TONE[h?.status ?? 'NOT_CONFIGURED'] ?? 'var(--text-4)'}>
                  {h?.status}
                </Pill>
                {circuit && circuit.state !== 'CLOSED' && (
                  <Pill tone={CIRCUIT_TONE[circuit.state]}>
                    CIRCUIT {circuit.state} · {circuit.consecutiveFailures} fails
                  </Pill>
                )}
                <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-3)' }}>
                  {caps.sourceMethod}
                </span>
                <span style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
                  {caps.providers.map((p) => (
                    <span
                      key={p}
                      className="eyebrow"
                      style={{
                        padding: '2px 6px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-xs)',
                      }}
                    >
                      {providerProfile(p).displayName}
                    </span>
                  ))}
                </span>
              </div>

              <p
                style={{
                  marginTop: 7,
                  fontSize: 'var(--t-sm)',
                  color: 'var(--text-2)',
                  lineHeight: 1.5,
                }}
              >
                {h?.detail}
              </p>

              {gate.blockerCode && (
                <p style={{ marginTop: 6, fontSize: 'var(--t-xs)', color: 'var(--warn)' }}>
                  Blocker <code className="mono">{gate.blockerCode}</code>
                  {gate.requiredEnv.length > 0 && (
                    <>
                      {' '}
                      · needs <code className="mono">{gate.requiredEnv.join(', ')}</code>
                    </>
                  )}
                </p>
              )}

              <dl
                className="tnum"
                style={{
                  marginTop: 12,
                  paddingTop: 11,
                  borderTop: '1px solid var(--border)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))',
                  gap: 10,
                }}
              >
                <Metric label="Calls" value={m?.calls ?? 0} />
                <Metric label="Cache hits" value={m?.cacheHits ?? 0} />
                <Metric label="Errors" value={m?.errors ?? 0} />
                <Metric label="Timeouts" value={m?.timeouts ?? 0} />
                <Metric label="p50" value={fmtMs(m?.p50Ms)} />
                <Metric label="p95" value={fmtMs(m?.p95Ms)} />
                <Metric
                  label="Success"
                  value={
                    m?.successRate === null || m?.successRate === undefined
                      ? '—'
                      : `${Math.round(m.successRate * 100)}%`
                  }
                />
                <Metric label="Last check" value={fmtMs(h?.latencyMs)} />
              </dl>
            </article>
          );
        })}
      </section>

      <section style={{ display: 'grid', gap: 9 }}>
        <h2 className="eyebrow">Usage this worker</h2>
        <dl
          className="tnum"
          style={{
            padding: '14px 16px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(122px, 1fr))',
            gap: 12,
          }}
        >
          <Metric label="Comparisons" value={snapshot.sessions} />
          <Metric
            label="Cache hit rate"
            value={
              snapshot.cacheHitRate === null ? '—' : `${Math.round(snapshot.cacheHitRate * 100)}%`
            }
          />
          <Metric label="Rate-limit events" value={snapshot.rateLimitEvents} />
          <Metric label="Est. source cost" value={`$${(estimatedCostMinor / 100).toFixed(2)}`} />
        </dl>
        <p style={{ fontSize: 'var(--t-xs)', color: 'var(--text-3)', lineHeight: 1.55 }}>
          Cost is modelled from per-call rates in{' '}
          <code className="mono">ESTIMATED_COST_PER_CALL_USD_CENTS</code>, which are zero until a
          contract sets them. It is an estimate, not a bill. These counters are per-worker and reset
          on deploy, so on a multi-worker or serverless runtime they show only this worker&rsquo;s
          share and will read low. Durable, complete history lives in{' '}
          <code className="mono">api_usage_daily</code>.
        </p>
        {errors.length > 0 && (
          <p style={{ fontSize: 'var(--t-xs)', color: 'var(--danger)' }}>
            {errors.length} startup {errors.length === 1 ? 'error' : 'errors'} above must be
            resolved before this deployment is production-ready.
          </p>
        )}
      </section>
    </main>
  );
}

function fmtMs(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v} ms`;
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className="eyebrow"
      style={{
        color: tone,
        border: `1px solid ${tone}`,
        borderRadius: 'var(--r-full)',
        padding: '2px 8px',
        opacity: 0.95,
      }}
    >
      {children}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd style={{ margin: '3px 0 0', fontSize: 'var(--t-md)', fontWeight: 640 }}>{value}</dd>
    </div>
  );
}
