/**
 * GET /api/admin/health — per-source status for the operator dashboard.
 *
 * Health checks issue real requests where a source is configured, so this is
 * rate-limited and never exposes credentials or route data.
 */
import { NextResponse } from 'next/server';
import { getConfig, startupChecks } from '@/config/env';
import { circuitBreaker } from '@/orchestration/circuit';
import { metrics } from '@/observability/metrics';
import { allSources, enabledLiveSources } from '@/sources/registry';
import { enforceRateLimit } from '../../_lib/request';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limit = await enforceRateLimit(req, 'admin');
  if (!limit.ok) return limit.response;

  const sources = allSources();
  const health = await Promise.all(
    sources.map(async (s) => {
      try {
        return await s.healthCheck();
      } catch (err) {
        return {
          sourceId: s.capabilities().sourceId,
          status: 'UNAVAILABLE' as const,
          detail: err instanceof Error ? err.message : 'Health check threw.',
          checkedAt: new Date().toISOString(),
          latencyMs: null,
          blockerCode: null,
        };
      }
    }),
  );

  const cfg = getConfig();
  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      checks: startupChecks(cfg, enabledLiveSources().length),
      sources: sources.map((s, i) => ({
        capabilities: s.capabilities(),
        enablement: s.enablement(),
        health: health[i],
      })),
      metrics: metrics.snapshot(),
      circuits: circuitBreaker.snapshot(),
    },
    { headers: { ...limit.headers, 'Cache-Control': 'no-store' } },
  );
}
