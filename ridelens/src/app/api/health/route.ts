/**
 * Public health endpoint.
 *
 * Deliberately states whether the deployment can produce LIVE data at all.
 * A deployment with no live source says so here rather than looking healthy
 * while returning nothing.
 */
import { NextResponse } from 'next/server';
import { getConfig, startupChecks } from '@/config/env';
import { allSources, enabledLiveSources } from '@/sources/registry';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = getConfig();
  const live = enabledLiveSources();
  const checks = startupChecks(cfg, live.length);
  const worst = checks.some((c) => c.level === 'error')
    ? 'error'
    : checks.some((c) => c.level === 'warn')
      ? 'warn'
      : 'ok';

  return NextResponse.json(
    {
      status: worst === 'error' ? 'degraded' : 'ok',
      liveDataAvailable: live.length > 0,
      liveSources: live.map((s) => s.capabilities().sourceId),
      fixtureSourceActive: cfg.demoSourceActive,
      geocoder: cfg.geocoderProvider,
      persistence: cfg.persistence,
      rateLimiter: cfg.rateLimiter,
      sources: allSources().map((s) => {
        const caps = s.capabilities();
        const gate = s.enablement();
        return {
          sourceId: caps.sourceId,
          displayName: caps.displayName,
          enabled: gate.enabled,
          blockerCode: gate.blockerCode,
          providers: caps.providers,
        };
      }),
      checks,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
