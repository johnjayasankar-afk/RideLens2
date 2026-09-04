import {
  curbConfigured,
  empowerConfigured,
  fixturesAllowed,
  getEnv,
  lyftConfigured,
  obiConfigured,
  rateCardConfigured,
  uberComparisonAuthorized,
  type AppEnv,
} from "@/lib/config";
import { CurbFlowQuoteSource } from "@/lib/sources/curb/curb-flow-quote-source";
import { EmpowerAuthorizedQuoteSource } from "@/lib/sources/empower/empower-authorized-quote-source";
import { FixtureQuoteSource } from "@/lib/sources/fixture/fixture-quote-source";
import { LyftAuthorizedQuoteSource } from "@/lib/sources/lyft/lyft-authorized-quote-source";
import { ObiQuoteSource } from "@/lib/sources/obi/obi-quote-source";
import { PublicRateCardQuoteSource } from "@/lib/sources/ratecard/public-rate-card-quote-source";
import type { QuoteSource } from "@/lib/sources/types";
import { UberAuthorizedQuoteSource } from "@/lib/sources/uber/uber-authorized-quote-source";

/**
 * Discover sources that should participate in a quote session.
 * Public rate-card + OSRM is enabled by default (no API keys).
 */
export function discoverEnabledSources(env: AppEnv = getEnv()): QuoteSource[] {
  const sources: QuoteSource[] = [];

  if (rateCardConfigured(env)) sources.push(new PublicRateCardQuoteSource());
  if (obiConfigured(env)) sources.push(new ObiQuoteSource());
  if (lyftConfigured(env)) sources.push(new LyftAuthorizedQuoteSource());
  if (curbConfigured(env)) sources.push(new CurbFlowQuoteSource());
  if (empowerConfigured(env)) sources.push(new EmpowerAuthorizedQuoteSource());
  if (uberComparisonAuthorized(env)) {
    sources.push(new UberAuthorizedQuoteSource());
  }
  if (fixturesAllowed(env)) sources.push(new FixtureQuoteSource());

  return sources;
}

export function listAllSources(): QuoteSource[] {
  return [
    new PublicRateCardQuoteSource(),
    new ObiQuoteSource(),
    new LyftAuthorizedQuoteSource(),
    new CurbFlowQuoteSource(),
    new EmpowerAuthorizedQuoteSource(),
    new UberAuthorizedQuoteSource(),
    ...(fixturesAllowed() ? [new FixtureQuoteSource()] : []),
  ];
}

export function sourceStatusSummary(env: AppEnv = getEnv()) {
  return {
    public_rate_card: rateCardConfigured(env) ? "enabled" : "disabled",
    obi: obiConfigured(env) ? "enabled" : "partner_approval",
    lyft: lyftConfigured(env)
      ? "enabled"
      : env.LYFT_COMPARISON_AUTHORIZED
        ? "misconfigured"
        : "partner_approval",
    curb: curbConfigured(env) ? "enabled" : "partner_approval",
    empower: empowerConfigured(env) ? "enabled" : "partner_approval",
    uber: uberComparisonAuthorized(env)
      ? "enabled"
      : "comparison_restricted",
    fixtures: fixturesAllowed(env) ? "enabled_non_prod" : "disabled",
  };
}
