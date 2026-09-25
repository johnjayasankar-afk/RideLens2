/**
 * Persistence.
 *
 * Two implementations behind one interface: Supabase for real deployments and
 * an in-memory store for local development and tests. Production refuses to
 * boot on the in-memory store (startupChecks NO_DURABLE_PERSISTENCE).
 *
 * Persistence NEVER blocks a response. A database outage degrades RideLens to
 * "comparison works, history does not", which is the correct trade for a
 * utility whose value is the live comparison itself.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '@/config/env';
import type { NormalizedQuote, QuoteSession, SourceDiscrepancy } from '@/domain/quote';
import { coarsen } from '@/location/types';
import { logger } from '@/observability/logger';
import type { SourceHealth } from '@/sources/types';

export interface HandoffEvent {
  sessionId: string | null;
  userId: string | null;
  provider: string;
  quoteKey: string;
  handoffKind: string;
  destinationHost: string;
  observedPriceMinor: number | null;
  currency: string | null;
  quoteAgeMs: number | null;
}

export interface Repository {
  saveSession(session: QuoteSession, opts: { userId?: string; anonKey?: string }): Promise<void>;
  getSession(id: string): Promise<QuoteSession | null>;
  recordHandoff(event: HandoffEvent): Promise<void>;
  recordHealth(health: SourceHealth[]): Promise<void>;
  usageSummary(days: number): Promise<UsageRow[]>;
  recentDiscrepancies(limit: number): Promise<SourceDiscrepancy[]>;
}

export interface UsageRow {
  day: string;
  sourceId: string;
  calls: number;
  cacheHits: number;
  errors: number;
  p50LatencyMs: number | null;
}

// --------------------------------------------------------------- in-memory
export class MemoryRepository implements Repository {
  private sessions = new Map<string, QuoteSession>();
  private handoffs: HandoffEvent[] = [];
  private healthLog: SourceHealth[] = [];
  private discrepancies: SourceDiscrepancy[] = [];

  async saveSession(session: QuoteSession): Promise<void> {
    // Bound growth in long-running dev servers.
    if (this.sessions.size > 500) {
      const oldest = this.sessions.keys().next();
      if (!oldest.done) this.sessions.delete(oldest.value);
    }
    this.sessions.set(session.id, session);
    this.discrepancies.push(...session.discrepancies);
  }

  async getSession(id: string): Promise<QuoteSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async recordHandoff(event: HandoffEvent): Promise<void> {
    this.handoffs.push(event);
  }

  async recordHealth(health: SourceHealth[]): Promise<void> {
    this.healthLog = health;
  }

  latestHealth(): SourceHealth[] {
    return this.healthLog;
  }

  async usageSummary(): Promise<UsageRow[]> {
    return [];
  }

  async recentDiscrepancies(limit: number): Promise<SourceDiscrepancy[]> {
    return this.discrepancies.slice(-limit).reverse();
  }
}

// ---------------------------------------------------------------- Supabase
export class SupabaseRepository implements Repository {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async saveSession(
    session: QuoteSession,
    opts: { userId?: string; anonKey?: string },
  ): Promise<void> {
    // Coarse coordinates only — the column type cannot hold anything finer.
    const p = coarsen(session.pickup.lat, session.pickup.lng);
    const d = coarsen(session.destination.lat, session.destination.lng);

    const { error: sessionError } = await this.client.from('quote_sessions').upsert({
      id: session.id,
      user_id: opts.userId ?? null,
      anon_key: opts.anonKey ?? null,
      status: session.status,
      pickup_lat_coarse: p.lat,
      pickup_lng_coarse: p.lng,
      dest_lat_coarse: d.lat,
      dest_lng_coarse: d.lng,
      pickup_city: session.pickup.city,
      dest_city: session.destination.city,
      geocoder: session.pickup.geocoder,
      sources_expected: session.coverage.sourcesExpected,
      sources_succeeded: session.coverage.sourcesSucceeded,
      sources_failed: session.coverage.sourcesFailed,
      providers_returned: session.coverage.providersReturned,
      quote_count: session.quotes.length,
      created_at: session.createdAt,
      completed_at: session.completedAt,
    });
    if (sessionError) throw new Error(sessionError.message);

    if (session.outcomes.length > 0) {
      await this.client.from('provider_requests').insert(
        session.outcomes.map((o) => ({
          session_id: session.id,
          source_id: o.sourceId,
          status: o.status,
          latency_ms: o.latencyMs,
          quote_count: o.quoteCount,
          cache_hit: o.cacheHit,
          blocker_code: o.blockerCode,
          message: o.message,
        })),
      );
    }

    // Every normalized candidate is retained for debugging; is_canonical marks
    // the one the rider actually saw.
    const canonicalIds = new Set(session.quotes.map((q) => q.id));
    if (session.candidates.length > 0) {
      await this.client
        .from('quotes')
        .insert(session.candidates.map((q) => quoteRow(session.id, q, canonicalIds.has(q.id))));
    }

    if (session.discrepancies.length > 0) {
      await this.client.from('source_discrepancies').insert(
        session.discrepancies.map((x) => ({
          session_id: session.id,
          provider: x.provider,
          normalized_category: x.normalizedCategory,
          canonical_quote_key: x.canonicalQuoteId,
          conflicting_keys: x.conflictingQuoteIds,
          spread_minor: x.spreadMinor,
          spread_bps: x.spreadBps,
          currency: x.currency,
          severity: x.severity,
        })),
      );
    }
  }

  async getSession(id: string): Promise<QuoteSession | null> {
    const { data, error } = await this.client
      .from('quote_sessions')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    // Full rehydration is intentionally not implemented: a stored session is an
    // audit record, not a price. Re-running the comparison is the correct way
    // to see current prices, so the UI never replays an old session as live.
    return null;
  }

  async recordHandoff(event: HandoffEvent): Promise<void> {
    await this.client.from('booking_handoff_events').insert({
      session_id: event.sessionId,
      user_id: event.userId,
      provider: event.provider,
      quote_key: event.quoteKey,
      handoff_kind: event.handoffKind,
      destination_host: event.destinationHost,
      observed_price_minor: event.observedPriceMinor,
      currency: event.currency,
      quote_age_ms: event.quoteAgeMs,
    });
  }

  async recordHealth(health: SourceHealth[]): Promise<void> {
    if (health.length === 0) return;
    await this.client.from('provider_health_events').insert(
      health.map((h) => ({
        source_id: h.sourceId,
        status: h.status,
        detail: h.detail,
        blocker_code: h.blockerCode,
        latency_ms: h.latencyMs,
      })),
    );
  }

  async usageSummary(days: number): Promise<UsageRow[]> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('api_usage_daily')
      .select('day, source_id, calls, cache_hits, errors, p50_latency_ms')
      .gte('day', since)
      .order('day', { ascending: false });
    if (error || !data) return [];
    return data.map((r) => ({
      day: String(r.day),
      sourceId: String(r.source_id),
      calls: Number(r.calls),
      cacheHits: Number(r.cache_hits),
      errors: Number(r.errors),
      p50LatencyMs: r.p50_latency_ms === null ? null : Number(r.p50_latency_ms),
    }));
  }

  async recentDiscrepancies(limit: number): Promise<SourceDiscrepancy[]> {
    const { data, error } = await this.client
      .from('source_discrepancies')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({
      provider: r.provider,
      normalizedCategory: r.normalized_category,
      canonicalQuoteId: r.canonical_quote_key,
      conflictingQuoteIds: r.conflicting_keys ?? [],
      spreadMinor: Number(r.spread_minor),
      spreadBps: Number(r.spread_bps),
      currency: r.currency,
      severity: r.severity,
    }));
  }
}

function quoteRow(sessionId: string, q: NormalizedQuote, isCanonical: boolean) {
  return {
    session_id: sessionId,
    quote_key: q.id,
    provider: q.provider,
    provider_product_id: q.providerProductId,
    provider_product_name: q.providerProductName,
    normalized_category: q.normalizedCategory,
    price_type: q.priceType,
    price_min_minor: q.priceMinMinor,
    price_max_minor: q.priceMaxMinor,
    display_price_minor: q.displayPriceMinor,
    ranking_price_minor: q.rankingPriceMinor,
    currency: q.currency,
    pickup_eta_seconds: q.pickupEtaSeconds,
    trip_duration_seconds: q.tripDurationSeconds,
    distance_meters: q.distanceMeters,
    availability: q.availability,
    source: q.source,
    source_method: q.sourceMethod,
    account_context: q.accountContext,
    confidence_class: q.confidenceClass,
    is_canonical: isCanonical,
    received_at: q.receivedAt,
    provider_timestamp: q.providerTimestamp,
    expires_at: q.expiresAt,
    metadata: q.metadata,
  };
}

let repo: Repository | null = null;

export function getRepository(): Repository {
  if (repo) return repo;
  const cfg = getConfig();
  if (
    cfg.persistence === 'supabase' &&
    cfg.NEXT_PUBLIC_SUPABASE_URL &&
    cfg.SUPABASE_SERVICE_ROLE_KEY
  ) {
    repo = new SupabaseRepository(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);
  } else {
    repo = new MemoryRepository();
  }
  return repo;
}

export function resetRepository(): void {
  repo = null;
}

/** Fire-and-forget persistence. A storage failure must never fail a comparison. */
export function persistInBackground(fn: () => Promise<void>, context: string): void {
  void fn().catch((err: unknown) => {
    logger.warn('persistence.failed', {
      context,
      message: err instanceof Error ? err.message : 'unknown',
    });
  });
}
