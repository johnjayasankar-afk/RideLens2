/**
 * Source registry. Every source is instantiated; enablement is decided per
 * request from configuration, so a credential appearing does not require a
 * redeploy of anything but the env.
 */
import type { SourceId } from '@/domain/quote';
import { CurbFlowQuoteSource } from './curb/CurbFlowQuoteSource';
import { DemoQuoteSource } from './demo/DemoQuoteSource';
import { EmpowerAuthorizedQuoteSource } from './empower/EmpowerAuthorizedQuoteSource';
import { LyftAuthorizedQuoteSource } from './lyft/LyftAuthorizedQuoteSource';
import { ObiQuoteSource } from './obi/ObiQuoteSource';
import { BikeShareQuoteSource } from './bikeshare/BikeShareQuoteSource';
import { PublicRateCardQuoteSource } from './ratecard/PublicRateCardQuoteSource';
import { RegionalRailQuoteSource } from './rail/RegionalRailQuoteSource';
import { UberAuthorizedQuoteSource } from './uber/UberAuthorizedQuoteSource';
import type { QuoteSource } from './types';

let registry: QuoteSource[] | null = null;

export function allSources(): QuoteSource[] {
  if (!registry) {
    registry = [
      new ObiQuoteSource(),
      new CurbFlowQuoteSource(),
      new PublicRateCardQuoteSource(),
      new BikeShareQuoteSource(),
      new RegionalRailQuoteSource(),
      new UberAuthorizedQuoteSource(),
      new LyftAuthorizedQuoteSource(),
      new EmpowerAuthorizedQuoteSource(),
      new DemoQuoteSource(),
    ];
  }
  return registry;
}

export function resetRegistry(): void {
  registry = null;
}

export function enabledSources(): QuoteSource[] {
  return allSources().filter((s) => s.enablement().enabled);
}

/** Live = enabled and not the fixture source. Drives the "is this real?" checks. */
export function enabledLiveSources(): QuoteSource[] {
  return enabledSources().filter((s) => s.capabilities().sourceMethod !== 'LOCAL_FIXTURE');
}

export function sourceById(id: SourceId): QuoteSource | null {
  return allSources().find((s) => s.capabilities().sourceId === id) ?? null;
}
