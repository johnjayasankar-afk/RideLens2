import { randomUUID } from "crypto";
import { getEnv } from "@/lib/config";
import { computeFreshness } from "@/lib/domain/freshness";
import { reconcileQuotes } from "@/lib/domain/reconciler";
import { rankQuotes } from "@/lib/domain/ranking";
import type {
  CanonicalLocation,
  NormalizedQuote,
  QuoteSession,
  QuoteSessionStatus,
  RankingMode,
  RideCategory,
  SourceQuoteResult,
} from "@/lib/domain/types";
import {
  buildQuoteCacheKey,
  cacheGet,
  cacheSet,
} from "@/lib/quotes/cache";
import { discoverEnabledSources } from "@/lib/sources/registry";
import type { QuoteSource } from "@/lib/sources/types";

export type SourceProgressEvent =
  | {
      type: "session";
      session: QuoteSession;
    }
  | {
      type: "source_result";
      result: SourceQuoteResult;
      session: QuoteSession;
    }
  | {
      type: "complete";
      session: QuoteSession;
    };

const sessions = new Map<string, QuoteSession>();

export function getSession(id: string): QuoteSession | undefined {
  return sessions.get(id);
}

export function listRecentSessions(limit = 20): QuoteSession[] {
  return [...sessions.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

function withFreshness(quotes: NormalizedQuote[]): NormalizedQuote[] {
  const now = new Date();
  return quotes.map((q) => ({
    ...q,
    freshness: computeFreshness(q.receivedAt, q.expiresAt, now),
  }));
}

function deriveStatus(
  expected: string[],
  succeeded: string[],
  failed: string[],
  quoteCount: number,
): QuoteSessionStatus {
  if (succeeded.length === 0 && failed.length >= expected.length) return "FAILED";
  if (succeeded.length + failed.length < expected.length) {
    return quoteCount > 0 ? "PARTIAL" : "RUNNING";
  }
  if (failed.length > 0 && quoteCount > 0) return "PARTIAL";
  if (quoteCount === 0) return "FAILED";
  return "SUCCESS";
}

async function fetchSource(
  source: QuoteSource,
  request: Parameters<QuoteSource["getQuotes"]>[0],
  timeoutMs: number,
): Promise<SourceQuoteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await source.getQuotes({
      ...request,
      signal: request.signal ?? controller.signal,
    });
  } catch (e) {
    return {
      sourceId: source.id,
      ok: false,
      quotes: [],
      latencyMs: timeoutMs,
      failure: {
        sourceId: source.id,
        code: e instanceof Error && e.name === "AbortError" ? "TIMEOUT" : "ERROR",
        message: e instanceof Error ? e.message : "Source failed",
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runQuoteSession(input: {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  rankingMode?: RankingMode;
  categoryFilter?: RideCategory[] | "ALL" | "standard";
  userId?: string;
  accountContext?: QuoteSession["quotes"][0]["accountContext"];
  onEvent?: (event: SourceProgressEvent) => void;
  skipCache?: boolean;
}): Promise<QuoteSession> {
  const env = getEnv();
  const sources = discoverEnabledSources(env);
  const accountContext = input.accountContext ?? "PUBLIC";
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  const cacheKey = buildQuoteCacheKey({
    pickupLat: input.pickup.lat,
    pickupLng: input.pickup.lng,
    destLat: input.destination.lat,
    destLng: input.destination.lng,
    accountContext,
    userId: input.userId,
    sources: sources.map((s) => s.id),
    rankingMode: input.rankingMode ?? "cheapest",
    categoryFilter:
      input.categoryFilter == null
        ? "standard"
        : Array.isArray(input.categoryFilter)
          ? input.categoryFilter.join(",")
          : input.categoryFilter,
  });

  if (!input.skipCache && accountContext === "PUBLIC") {
    const cached = cacheGet<QuoteSession>(cacheKey);
    if (cached) {
      const refreshed: QuoteSession = {
        ...cached,
        id: sessionId,
        quotes: withFreshness(cached.quotes),
        updatedAt: now,
      };
      sessions.set(sessionId, refreshed);
      input.onEvent?.({ type: "complete", session: refreshed });
      return refreshed;
    }
  }

  let session: QuoteSession = {
    id: sessionId,
    status: sources.length === 0 ? "FAILED" : "RUNNING",
    pickup: input.pickup,
    destination: input.destination,
    createdAt: now,
    updatedAt: now,
    coverage: {
      sourcesExpected: sources.map((s) => s.id),
      sourcesSucceeded: [],
      sourcesFailed:
        sources.length === 0
          ? [
              {
                sourceId: "registry",
                code: "NO_SOURCES",
                message:
                  "No live quote sources configured. See SETUP_REQUIRED.md for Obi/Curb/Lyft partner access.",
              },
            ]
          : [],
      providersReturned: [],
    },
    quotes: [],
    discrepancies: [],
    rankingMode: input.rankingMode ?? "cheapest",
    categoryFilter:
      input.categoryFilter === "standard" || input.categoryFilter == null
        ? (["STANDARD", "ECONOMY", "TAXI"] as RideCategory[])
        : input.categoryFilter,
  };

  sessions.set(sessionId, session);
  input.onEvent?.({ type: "session", session });

  if (sources.length === 0) {
    input.onEvent?.({ type: "complete", session });
    return session;
  }

  const allCandidates: NormalizedQuote[] = [];

  const results = await Promise.allSettled(
    sources.map((source) =>
      fetchSource(
        source,
        {
          pickup: input.pickup,
          destination: input.destination,
          accountContext,
          userId: input.userId,
          sessionId,
        },
        env.QUOTE_REQUEST_TIMEOUT_MS,
      ).then((result) => {
        if (result.ok) {
          allCandidates.push(...result.quotes);
          session = {
            ...session,
            coverage: {
              ...session.coverage,
              sourcesSucceeded: [
                ...session.coverage.sourcesSucceeded,
                result.sourceId,
              ],
              providersReturned: [
                ...new Set([
                  ...session.coverage.providersReturned,
                  ...result.quotes.map((q) => q.provider),
                ]),
              ],
            },
          };
        } else {
          session = {
            ...session,
            coverage: {
              ...session.coverage,
              sourcesFailed: [
                ...session.coverage.sourcesFailed,
                {
                  sourceId: result.sourceId,
                  code: result.failure?.code || "ERROR",
                  message: result.failure?.message || "Source failed",
                },
              ],
            },
          };
        }

        const reconciled = reconcileQuotes(withFreshness(allCandidates));
        // Keep full catalog in session; UI filters client-side so XL/Premium chips work.
        const ranked = rankQuotes(
          reconciled.visible,
          session.rankingMode,
          "ALL",
        );

        session = {
          ...session,
          updatedAt: new Date().toISOString(),
          quotes: ranked,
          discrepancies: reconciled.discrepancies,
          status: deriveStatus(
            session.coverage.sourcesExpected,
            session.coverage.sourcesSucceeded,
            session.coverage.sourcesFailed.map((f) => f.sourceId),
            ranked.length,
          ),
        };
        sessions.set(sessionId, session);
        input.onEvent?.({ type: "source_result", result, session });
        return result;
      }),
    ),
  );

  void results;

  const reconciled = reconcileQuotes(withFreshness(allCandidates));
  const ranked = rankQuotes(
    reconciled.visible,
    session.rankingMode,
    "ALL",
  );

  session = {
    ...session,
    updatedAt: new Date().toISOString(),
    quotes: ranked,
    discrepancies: reconciled.discrepancies,
    status: deriveStatus(
      session.coverage.sourcesExpected,
      session.coverage.sourcesSucceeded,
      session.coverage.sourcesFailed.map((f) => f.sourceId),
      ranked.length,
    ),
  };
  sessions.set(sessionId, session);

  if (accountContext === "PUBLIC" && ranked.length > 0) {
    cacheSet(cacheKey, session, accountContext);
  }

  input.onEvent?.({ type: "complete", session });
  return session;
}

export function recordUsage(event: {
  sourceId: string;
  ok: boolean;
  latencyMs: number;
}): void {
  // In-memory rollup for admin dashboard; persisted when Supabase configured
  const key = `${new Date().toISOString().slice(0, 10)}`;
  const bucket = usageDaily.get(key) ?? {
    comparisons: 0,
    sourceCalls: 0,
    sourceErrors: 0,
    latencySum: 0,
  };
  bucket.sourceCalls += 1;
  if (!event.ok) bucket.sourceErrors += 1;
  bucket.latencySum += event.latencyMs;
  usageDaily.set(key, bucket);
}

const usageDaily = new Map<
  string,
  {
    comparisons: number;
    sourceCalls: number;
    sourceErrors: number;
    latencySum: number;
  }
>();

export function incrementComparisonCount(): void {
  const key = `${new Date().toISOString().slice(0, 10)}`;
  const bucket = usageDaily.get(key) ?? {
    comparisons: 0,
    sourceCalls: 0,
    sourceErrors: 0,
    latencySum: 0,
  };
  bucket.comparisons += 1;
  usageDaily.set(key, bucket);
}

export function getUsageToday() {
  const key = `${new Date().toISOString().slice(0, 10)}`;
  const bucket = usageDaily.get(key) ?? {
    comparisons: 0,
    sourceCalls: 0,
    sourceErrors: 0,
    latencySum: 0,
  };
  return {
    ...bucket,
    avgLatencyMs:
      bucket.sourceCalls === 0
        ? null
        : Math.round(bucket.latencySum / bucket.sourceCalls),
  };
}
