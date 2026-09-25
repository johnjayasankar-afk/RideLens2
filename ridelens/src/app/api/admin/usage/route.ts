/**
 * GET /api/admin/usage — API usage and cost control view.
 *
 * Estimated cost is labelled as an estimate everywhere it appears; it is a
 * model, not a bill.
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/db/repository';
import { ESTIMATED_COST_PER_CALL_USD_CENTS, metrics } from '@/observability/metrics';
import { enforceRateLimit } from '../../_lib/request';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limit = await enforceRateLimit(req, 'admin');
  if (!limit.ok) return limit.response;

  const snapshot = metrics.snapshot();
  const repo = getRepository();
  const [daily, discrepancies] = await Promise.all([
    repo.usageSummary(7).catch(() => []),
    repo.recentDiscrepancies(25).catch(() => []),
  ]);

  const estimatedCostMinor = snapshot.sources.reduce(
    (sum, s) => sum + s.calls * (ESTIMATED_COST_PER_CALL_USD_CENTS[s.sourceId] ?? 0),
    0,
  );

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      processMetrics: snapshot,
      estimatedCostMinor,
      estimatedCostIsModelled: true,
      daily,
      discrepancies,
    },
    { headers: { ...limit.headers, 'Cache-Control': 'no-store' } },
  );
}
