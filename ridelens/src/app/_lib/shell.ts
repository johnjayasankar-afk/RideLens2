/**
 * Shared server-side view model for the comparison shell, so `/` and `/s/[id]`
 * cannot drift apart in what they tell the client about source availability.
 */
import { getConfig } from '@/config/env';
import type { ProviderId } from '@/domain/quote';
import { BIKE_SYSTEMS } from '@/sources/bikeshare/systems';
import { allSources, enabledLiveSources } from '@/sources/registry';
import { COVERED_MARKETS } from '@/sources/ratecard/tariffs';
import { RAIL_MARKETS } from '@/sources/rail/systems';

export interface ShellProps {
  sourceProviders: Record<string, ProviderId[]>;
  liveDataAvailable: boolean;
  fixtureBacked: boolean;
  blockerSummary: string | null;
  /**
   * Cities with a published rate card loaded. Sent from the server rather than
   * duplicated in the client bundle, so the list a rider reads is the same list
   * the pricing engine actually holds.
   */
  coveredMarkets: string[];
  /** Bike systems whose live feed is being read. */
  bikeSystems: string[];
  /** Railroads whose published fare table is loaded. */
  railSystems: string[];
}

export function shellProps(): ShellProps {
  const cfg = getConfig();
  const sources = allSources();

  const sourceProviders: Record<string, ProviderId[]> = Object.fromEntries(
    sources.map((s) => [s.capabilities().sourceId, s.capabilities().providers]),
  );

  const blockers = sources
    .map((s) => s.enablement())
    .filter((e) => !e.enabled && e.blockerCode !== 'NON_PRODUCTION_ONLY')
    .map((e) => e.blockerMessage)
    .filter((m): m is string => Boolean(m));

  return {
    sourceProviders,
    liveDataAvailable: enabledLiveSources().length > 0,
    fixtureBacked: cfg.demoSourceActive,
    blockerSummary: blockers[0] ?? null,
    coveredMarkets: [...COVERED_MARKETS],
    bikeSystems: BIKE_SYSTEMS.map((b) => b.name),
    railSystems: [...RAIL_MARKETS],
  };
}
