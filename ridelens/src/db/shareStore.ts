/**
 * Share-link storage.
 *
 * Supabase when configured, an in-process map otherwise. The in-process store
 * is honest about its limits: links survive only while the server runs, which
 * is fine for local development and stated in the UI copy.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '@/config/env';
import { isExpired, newShareId, shareExpiry, type SharedRoute } from '@/domain/share';
import type { CanonicalLocation } from '@/location/types';
import { clearSingleton, singleton } from '@/lib/singleton';
import { logger } from '@/observability/logger';

export interface ShareStore {
  create(pickup: CanonicalLocation, destination: CanonicalLocation): Promise<SharedRoute>;
  resolve(id: string): Promise<SharedRoute | null>;
  /** True when links outlive the process. */
  durable: boolean;
}

class MemoryShareStore implements ShareStore {
  readonly durable = false;
  /**
   * Pinned to the process, not to this module instance: Next may evaluate this
   * file more than once, and a link minted in one instance must resolve in the
   * other.
   */
  private routes = singleton('shareStore.routes', () => new Map<string, SharedRoute>());

  async create(pickup: CanonicalLocation, destination: CanonicalLocation): Promise<SharedRoute> {
    // Bound growth in a long-running dev server.
    if (this.routes.size > 2_000) {
      const oldest = this.routes.keys().next();
      if (!oldest.done) this.routes.delete(oldest.value);
    }
    const route: SharedRoute = {
      id: newShareId(),
      pickup,
      destination,
      createdAt: new Date().toISOString(),
      expiresAt: shareExpiry(),
    };
    this.routes.set(route.id, route);
    return route;
  }

  async resolve(id: string): Promise<SharedRoute | null> {
    const route = this.routes.get(id);
    if (!route) return null;
    if (isExpired(route)) {
      this.routes.delete(id);
      return null;
    }
    return route;
  }
}

class SupabaseShareStore implements ShareStore {
  readonly durable = true;
  private client: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async create(pickup: CanonicalLocation, destination: CanonicalLocation): Promise<SharedRoute> {
    const route: SharedRoute = {
      id: newShareId(),
      pickup,
      destination,
      createdAt: new Date().toISOString(),
      expiresAt: shareExpiry(),
    };
    const { error } = await this.client.from('shared_routes').insert({
      id: route.id,
      pickup: route.pickup,
      destination: route.destination,
      created_at: route.createdAt,
      expires_at: route.expiresAt,
    });
    if (error) throw new Error(error.message);
    return route;
  }

  async resolve(id: string): Promise<SharedRoute | null> {
    const { data, error } = await this.client
      .from('shared_routes')
      .select('id, pickup, destination, created_at, expires_at')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;

    const route: SharedRoute = {
      id: String(data.id),
      pickup: data.pickup as CanonicalLocation,
      destination: data.destination as CanonicalLocation,
      createdAt: String(data.created_at),
      expiresAt: String(data.expires_at),
    };
    if (isExpired(route)) return null;

    // Best-effort open counter; never block resolution on it.
    void (async () => {
      try {
        await this.client.rpc('increment_share_open', { share_id: id });
      } catch {
        /* telemetry only */
      }
    })();

    return route;
  }
}

let store: ShareStore | null = null;

export function getShareStore(): ShareStore {
  if (store) return store;
  const cfg = getConfig();
  if (
    cfg.persistence === 'supabase' &&
    cfg.NEXT_PUBLIC_SUPABASE_URL &&
    cfg.SUPABASE_SERVICE_ROLE_KEY
  ) {
    store = new SupabaseShareStore(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);
  } else {
    logger.info('share_store.memory', {
      note: 'Share links live only while this process runs.',
    });
    store = new MemoryShareStore();
  }
  return store;
}

export function resetShareStore(): void {
  store = null;
  clearSingleton('shareStore.routes');
}
