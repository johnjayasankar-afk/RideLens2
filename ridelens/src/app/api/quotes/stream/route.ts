/**
 * POST /api/quotes/stream — progressive comparison over NDJSON.
 *
 * Streaming choice: newline-delimited JSON over a normal POST response.
 * EventSource cannot POST, and Realtime would add a broker for a stream that
 * lives for four seconds. Plain fetch streaming is the simplest thing that
 * reliably delivers each provider the moment it lands, and it degrades to a
 * normal response body if the client cannot stream.
 *
 * Event sequence:
 *   {"type":"session",  ...}   route + which providers to skeleton
 *   {"type":"source",   ...}   one per source as it settles (may be an error)
 *   {"type":"complete", ...}   reconciled, ranked, final
 */
import { getConfig } from '@/config/env';
import { getRepository, persistInBackground } from '@/db/repository';
import type { ProviderId } from '@/domain/quote';
import { canonicalizeRoute, RouteError } from '@/location/canonical';
import { CompareRequestSchema as Schema } from '../../_lib/schemas';
import { runQuoteSession } from '@/orchestration/engine';
import { enabledSources } from '@/sources/registry';
import { apiError } from '../../_lib/errors';
import { enforceRateLimit } from '../../_lib/request';

export const dynamic = 'force-dynamic';

/*
 * The orchestrator budgets QUOTE_REQUEST_TIMEOUT_MS (8s by default) for
 * upstream calls and enforces its own deadline. Serverless platforms default
 * to around ten seconds, which would kill a slow-but-succeeding comparison a
 * moment before it answered. Thirty leaves room for the deadline to do its job
 * and report what arrived.
 */
export const maxDuration = 30;

function line(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

export async function POST(req: Request) {
  const limit = await enforceRateLimit(req, 'compare');
  if (!limit.ok) return limit.response;

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return apiError(400, 'BAD_REQUEST', 'Body must be JSON.');
  }

  const parsed = Schema.safeParse(parsedBody);
  if (!parsed.success) {
    return apiError(400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  const sources = enabledSources();
  if (sources.length === 0) {
    return apiError(
      503,
      'NO_SOURCE_CONFIGURED',
      'No quote source is currently enabled, so RideLens cannot show live prices. See /api/health for the exact blocker.',
    );
  }

  let route;
  try {
    route = await canonicalizeRoute(parsed.data.pickup, parsed.data.destination);
  } catch (err) {
    if (err instanceof RouteError) return apiError(422, err.code, err.message);
    return apiError(502, 'GEOCODER_UNAVAILABLE', 'Could not resolve those locations right now.');
  }

  const cfg = getConfig();
  const providersExpected = Array.from(
    new Set(sources.flatMap((s) => s.capabilities().providers)),
  ) as ProviderId[];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // Client disconnected mid-session; the run still completes and is
          // persisted, we simply stop writing.
        }
      };

      safeEnqueue(
        line({
          type: 'session',
          pickup: route.pickup,
          destination: route.destination,
          straightLineMeters: route.straightLineMeters,
          sourcesExpected: sources.map((s) => s.capabilities().sourceId),
          providersExpected,
          fixtureBacked: cfg.demoSourceActive,
        }),
      );

      try {
        const session = await runQuoteSession({
          pickup: route.pickup,
          destination: route.destination,
          locale: parsed.data.locale ?? 'en-US',
          partySize: parsed.data.partySize ?? 1,
          departAt: parsed.data.departAt ? new Date(parsed.data.departAt) : undefined,
          timeoutMs: cfg.QUOTE_REQUEST_TIMEOUT_MS,
          forceRefresh: parsed.data.refresh === true,
          onSourceSettled: (outcome, quotes) => {
            safeEnqueue(line({ type: 'source', outcome, quotes }));
          },
          signal: req.signal,
        });

        safeEnqueue(line({ type: 'complete', session }));
        persistInBackground(() => getRepository().saveSession(session, {}), 'saveSession');
      } catch (err) {
        safeEnqueue(
          line({
            type: 'error',
            message: err instanceof Error ? err.message : 'Comparison failed.',
          }),
        );
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...limit.headers,
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
