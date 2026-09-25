/**
 * GBFS client.
 *
 * Reads the auto-discovery document, then the three feeds that matter for a
 * quote: station locations, live station state, and the published pricing
 * plans. Every field is validated before it reaches the fare maths — a feed is
 * external input like any other.
 */
import { z } from 'zod';
import { httpJson } from '@/sources/http';
import { logger } from '@/observability/logger';
import type { BikeSystem } from './systems';

const DiscoverySchema = z.object({
  data: z.record(
    z.string(),
    z.object({ feeds: z.array(z.object({ name: z.string(), url: z.string().url() })) }),
  ),
});

const StationInfoSchema = z.object({
  data: z.object({
    stations: z.array(
      z.object({
        station_id: z.string(),
        name: z.string().nullish(),
        lat: z.number(),
        lon: z.number(),
        capacity: z.number().nullish(),
      }),
    ),
  }),
});

const StationStatusSchema = z.object({
  last_updated: z.number().nullish(),
  ttl: z.number().nullish(),
  data: z.object({
    stations: z.array(
      z.object({
        station_id: z.string(),
        num_bikes_available: z.number().nullish(),
        num_ebikes_available: z.number().nullish(),
        num_docks_available: z.number().nullish(),
        is_renting: z.union([z.number(), z.boolean()]).nullish(),
        is_returning: z.union([z.number(), z.boolean()]).nullish(),
      }),
    ),
  }),
});

const PricingSchema = z.object({
  data: z.object({
    plans: z.array(
      z.object({
        plan_id: z.string(),
        name: z.string().nullish(),
        currency: z.string(),
        price: z.union([z.number(), z.string()]),
        description: z.string().nullish(),
        per_min_pricing: z
          .array(z.object({ start: z.number(), rate: z.number(), interval: z.number() }))
          .nullish(),
      }),
    ),
  }),
});

export interface BikeStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bikesAvailable: number;
  ebikesAvailable: number;
  docksAvailable: number;
  renting: boolean;
  returning: boolean;
}

export interface PricingPlan {
  planId: string;
  name: string;
  currency: string;
  /** Unlock or base price, in minor units. */
  unlockMinor: number;
  /** Per-minute rate in minor units, when the plan publishes one. */
  perMinuteMinor: number | null;
  description: string | null;
}

export interface SystemSnapshot {
  system: BikeSystem;
  stations: BikeStation[];
  plans: PricingPlan[];
  /** When the operator says the station data was refreshed. */
  lastUpdated: string | null;
  ttlSeconds: number;
}

const TIMEOUT_MS = 5_000;

function hostOf(url: string): string {
  return new URL(url).hostname;
}

function truthy(v: number | boolean | null | undefined): boolean {
  // GBFS 1.x uses 0/1; 2.x uses booleans. Absent means "no reason to think not".
  if (v === null || v === undefined) return true;
  return typeof v === 'boolean' ? v : v !== 0;
}

/** Money in a GBFS plan is a decimal string or number of major units. */
function toMinor(value: number | string): number {
  const n = typeof value === 'number' ? value : Number(value.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  // Parse via a fixed decimal string so 4.99 never becomes 498.
  return Number((n.toFixed(2) as string).replace('.', ''));
}

/**
 * Some operators publish the per-minute rate only in the plan description
 * ("$4.99 unlock fee, $0.41 per minute"), which is exactly the case for Citi
 * Bike today. Reading it there is unavoidable if the price is to be right, so
 * it is parsed narrowly and only as a fallback.
 */
function perMinuteFromDescription(description: string | null | undefined): number | null {
  if (!description) return null;
  const m = /\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:per|\/|a)\s*min/i.exec(description);
  if (!m || !m[1]) return null;
  return toMinor(m[1]);
}

export async function fetchSystemSnapshot(
  system: BikeSystem,
  signal?: AbortSignal,
): Promise<SystemSnapshot | null> {
  try {
    // Declared hosts only: the client re-validates every redirect target, so a
    // feed that hops to a shared host must have that host listed on the system.
    const baseHosts = [hostOf(system.discoveryUrl), ...(system.extraHosts ?? [])];

    const discovery = DiscoverySchema.parse(
      await httpJson(system.discoveryUrl, {
        timeoutMs: TIMEOUT_MS,
        allowedHosts: baseHosts,
        signal,
      }),
    );

    // The discovery document is keyed by language; take whichever is present.
    const feeds = Object.values(discovery.data)[0]?.feeds ?? [];
    const urlFor = (name: string) => feeds.find((f) => f.name === name)?.url ?? null;

    const infoUrl = urlFor('station_information');
    const statusUrl = urlFor('station_status');
    const pricingUrl = urlFor('system_pricing_plans');
    if (!infoUrl || !statusUrl) return null;

    // The feeds a discovery document points at may live on another host.
    const allowed = Array.from(
      new Set([...baseHosts, ...[infoUrl, statusUrl, pricingUrl ?? infoUrl].map(hostOf)]),
    );

    const [infoRaw, statusRaw, pricingRaw] = await Promise.all([
      httpJson(infoUrl, { timeoutMs: TIMEOUT_MS, allowedHosts: allowed, signal }),
      httpJson(statusUrl, { timeoutMs: TIMEOUT_MS, allowedHosts: allowed, signal }),
      pricingUrl
        ? httpJson(pricingUrl, { timeoutMs: TIMEOUT_MS, allowedHosts: allowed, signal }).catch(
            () => null,
          )
        : Promise.resolve(null),
    ]);

    const info = StationInfoSchema.parse(infoRaw);
    const status = StationStatusSchema.parse(statusRaw);

    const statusById = new Map(status.data.stations.map((s) => [s.station_id, s]));
    const stations: BikeStation[] = info.data.stations.flatMap((s) => {
      const live = statusById.get(s.station_id);
      if (!live) return [];
      return [
        {
          id: s.station_id,
          name: s.name ?? 'Station',
          lat: s.lat,
          lng: s.lon,
          bikesAvailable: live.num_bikes_available ?? 0,
          ebikesAvailable: live.num_ebikes_available ?? 0,
          docksAvailable: live.num_docks_available ?? 0,
          renting: truthy(live.is_renting),
          returning: truthy(live.is_returning),
        },
      ];
    });

    let plans: PricingPlan[] = [];
    if (pricingRaw) {
      const parsed = PricingSchema.safeParse(pricingRaw);
      if (parsed.success) {
        plans = parsed.data.data.plans.map((p) => {
          const structured = p.per_min_pricing?.[0];
          const perMinute = structured
            ? Math.round((structured.rate * 100) / Math.max(1, structured.interval))
            : perMinuteFromDescription(p.description);
          return {
            planId: p.plan_id,
            name: p.name ?? p.plan_id,
            currency: p.currency.toUpperCase(),
            unlockMinor: toMinor(p.price),
            perMinuteMinor: perMinute,
            description: p.description ?? null,
          };
        });
      }
    }

    return {
      system,
      stations,
      plans,
      lastUpdated:
        typeof status.last_updated === 'number'
          ? new Date(status.last_updated * 1000).toISOString()
          : null,
      ttlSeconds: typeof status.ttl === 'number' && status.ttl > 0 ? status.ttl : 60,
    };
  } catch (err) {
    logger.debug('gbfs.fetch_failed', {
      system: system.id,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}
