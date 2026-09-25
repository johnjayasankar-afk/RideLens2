/**
 * Live verification.
 *
 * Issues REAL external requests with whatever credentials are configured and
 * prints exactly what came back — request time, response time, providers,
 * products, prices, ETAs, quote types and freshness. It never books a ride.
 *
 *   npm run verify:live
 *   npm run verify:live -- --dump obi     # print the raw source payload
 *
 * Anything that cannot run says why, with the env var that would fix it.
 */
import { getConfig, startupChecks } from '../src/config/env';
import { canonicalizeRoute } from '../src/location/canonical';
import { getGeocoder } from '../src/location/geocoder';
import { formatMoney, formatRange } from '../src/domain/money';
import { runQuoteSession } from '../src/orchestration/engine';
import { allSources, enabledLiveSources } from '../src/sources/registry';
import type { NormalizedQuote } from '../src/domain/quote';

const args = process.argv.slice(2);
const dumpSource = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null;

/** A real, well-known route that every US ride-hail market can price. */
const ROUTE = {
  pickup: process.env.VERIFY_PICKUP ?? '14 Prince St, New York',
  destination: process.env.VERIFY_DESTINATION ?? 'JFK Airport',
};

function line(char = '─'): void {
  console.log(char.repeat(78));
}

function ms(n: number): string {
  return `${n} ms`;
}

async function main(): Promise<void> {
  const cfg = getConfig();

  console.log('\nRideLens live verification');
  line('=');
  console.log(`env               ${cfg.NODE_ENV}`);
  console.log(`geocoder          ${cfg.geocoderProvider}`);
  console.log(`persistence       ${cfg.persistence}`);
  console.log(`rate limiter      ${cfg.rateLimiter}`);
  console.log(`started           ${new Date().toISOString()}`);

  const checks = startupChecks(cfg, enabledLiveSources().length);
  if (checks.length > 0) {
    console.log('\nStartup checks');
    line();
    for (const c of checks) console.log(`  [${c.level.toUpperCase()}] ${c.code}: ${c.message}`);
  }

  // ---------------------------------------------------------------- location
  console.log('\n1 · LOCATION — live geocoder request');
  line();
  const caps = getGeocoder().capabilities();
  console.log(`provider          ${caps.id} (key required: ${caps.requiresApiKey})`);
  if (caps.attribution) console.log(`attribution       ${caps.attribution}`);

  let route: Awaited<ReturnType<typeof canonicalizeRoute>>;
  const geoStart = Date.now();
  try {
    const suggestions = await getGeocoder().autocomplete(ROUTE.destination);
    console.log(
      `autocomplete      ${suggestions.length} suggestions in ${ms(Date.now() - geoStart)}`,
    );
    for (const s of suggestions.slice(0, 3)) {
      console.log(`                  · ${s.primaryText} — ${s.secondaryText} [${s.kind}]`);
    }

    const resolveStart = Date.now();
    route = await canonicalizeRoute(
      { kind: 'query', text: ROUTE.pickup },
      { kind: 'query', text: ROUTE.destination },
    );
    console.log(`resolve           ${ms(Date.now() - resolveStart)}`);
    console.log(`pickup            ${route.pickup.formattedAddress}`);
    console.log(`                  ${route.pickup.lat.toFixed(6)}, ${route.pickup.lng.toFixed(6)}`);
    console.log(`destination       ${route.destination.formattedAddress}`);
    console.log(
      `                  ${route.destination.lat.toFixed(6)}, ${route.destination.lng.toFixed(6)}`,
    );
    console.log(`straight line     ${(route.straightLineMeters / 1000).toFixed(2)} km`);
    console.log('\n  LOCATION: LIVE VERIFIED');
  } catch (err) {
    console.log(`\n  LOCATION: FAILED — ${err instanceof Error ? err.message : 'unknown'}`);
    process.exitCode = 1;
    return;
  }

  // ------------------------------------------------------------------ sources
  console.log('\n2 · SOURCES — enablement');
  line();
  for (const source of allSources()) {
    const c = source.capabilities();
    const gate = source.enablement();
    const status = gate.enabled ? 'ENABLED' : `BLOCKED (${gate.blockerCode})`;
    console.log(`${c.sourceId.padEnd(16)} ${status}`);
    console.log(`${''.padEnd(16)} providers: ${c.providers.join(', ')}`);
    if (!gate.enabled) {
      console.log(`${''.padEnd(16)} ${gate.blockerMessage}`);
      if (gate.requiredEnv.length > 0) {
        console.log(`${''.padEnd(16)} set: ${gate.requiredEnv.join(', ')}`);
      }
    }
  }

  const live = enabledLiveSources();
  if (live.length === 0) {
    console.log('\n3 · QUOTES');
    line();
    console.log('  BLOCKED — no live quote source is configured.');
    console.log('  RideLens will not display any price. See SETUP_REQUIRED.md.');
    console.log('\n  MULTI-PROVIDER COMPARISON: BLOCKED (awaiting partner credentials)');
    console.log('  No fixture data is substituted, here or in the product.\n');
    return;
  }

  // ------------------------------------------------------------------- health
  console.log('\n3 · SOURCE HEALTH — live requests');
  line();
  for (const source of live) {
    const health = await source.healthCheck();
    console.log(
      `${health.sourceId.padEnd(16)} ${health.status.padEnd(16)} ${health.latencyMs === null ? '' : ms(health.latencyMs)}`,
    );
    console.log(`${''.padEnd(16)} ${health.detail}`);
  }

  // ------------------------------------------------------------------- quotes
  console.log('\n4 · QUOTES — live multi-provider comparison');
  line();
  const requestedAt = new Date();
  const started = Date.now();
  const session = await runQuoteSession({
    pickup: route.pickup,
    destination: route.destination,
    timeoutMs: cfg.QUOTE_REQUEST_TIMEOUT_MS,
    forceRefresh: true,
  });
  const elapsed = Date.now() - started;
  const respondedAt = new Date();

  console.log(`request sent      ${requestedAt.toISOString()}`);
  console.log(`response settled  ${respondedAt.toISOString()}`);
  console.log(`total latency     ${ms(elapsed)}`);
  console.log(`session status    ${session.status}`);
  console.log(`sources ok        ${session.coverage.sourcesSucceeded.join(', ') || '(none)'}`);
  console.log(`sources failed    ${session.coverage.sourcesFailed.join(', ') || '(none)'}`);
  console.log(`providers         ${session.coverage.providersReturned.join(', ') || '(none)'}`);

  console.log('\nPer-source outcome');
  line();
  for (const o of session.outcomes) {
    console.log(
      `${o.sourceId.padEnd(16)} ${o.status.padEnd(14)} ${String(o.quoteCount).padStart(3)} quotes  ${o.latencyMs === null ? '—' : ms(o.latencyMs)}${o.cacheHit ? '  (cache)' : ''}`,
    );
    if (o.message) console.log(`${''.padEnd(16)} ${o.message}`);
  }

  if (session.quotes.length > 0) {
    console.log('\nNormalized quotes');
    line();
    console.log(
      `${'PROVIDER'.padEnd(10)}${'PRODUCT'.padEnd(20)}${'PRICE'.padEnd(16)}${'TYPE'.padEnd(16)}${'ETA'.padEnd(8)}${'FRESH'.padEnd(8)}CAT`,
    );
    for (const q of session.quotes) console.log(formatQuoteRow(q));
  }

  if (session.discrepancies.length > 0) {
    console.log('\nSource discrepancies');
    line();
    for (const d of session.discrepancies) {
      console.log(
        `${d.provider}/${d.normalizedCategory}: spread ${formatMoney(d.spreadMinor, d.currency)} (${d.spreadBps} bps) — ${d.severity}`,
      );
    }
  }

  if (dumpSource) {
    console.log(`\nRaw candidates from ${dumpSource}`);
    line();
    console.log(
      JSON.stringify(
        session.candidates.filter((q) => q.source === dumpSource),
        null,
        2,
      ),
    );
  }

  console.log('\nVerdict');
  line();

  const providerCount = session.coverage.providersReturned.length;
  const marketPriced = session.quotes.filter((q) => q.sourceMethod !== 'PUBLISHED_TARIFF').length;
  const tariffPriced = session.quotes.filter((q) => q.sourceMethod === 'PUBLISHED_TARIFF').length;

  if (tariffPriced > 0) {
    console.log(
      `  CREDENTIAL-FREE LIVE PRICING: VERIFIED (${tariffPriced} regulated fare${tariffPriced === 1 ? '' : 's'})`,
    );
  }
  if (marketPriced > 0) {
    console.log(`  MARKET PRICING: LIVE VERIFIED (${marketPriced} quotes from contracted feeds)`);
  } else {
    console.log('  MARKET PRICING: BLOCKED — Uber, Lyft and Empower need an authorized feed.');
  }
  console.log(
    providerCount >= 2
      ? `  MULTI-PROVIDER COMPARISON: LIVE VERIFIED (${providerCount} providers)`
      : `  MULTI-PROVIDER COMPARISON: PARTIAL (${providerCount} provider)`,
  );
  console.log('  No ride was requested.\n');
}

function formatQuoteRow(q: NormalizedQuote): string {
  const price =
    q.priceType === 'ESTIMATE_RANGE' && q.priceMinMinor !== q.priceMaxMinor
      ? formatRange(q.priceMinMinor, q.priceMaxMinor, q.currency)
      : formatMoney(q.displayPriceMinor, q.currency);
  const eta = q.pickupEtaSeconds === null ? '—' : `${Math.round(q.pickupEtaSeconds / 60)}m`;
  return (
    q.provider.padEnd(10) +
    q.providerProductName.slice(0, 19).padEnd(20) +
    price.padEnd(16) +
    q.priceType.padEnd(16) +
    eta.padEnd(8) +
    q.freshness.padEnd(8) +
    q.normalizedCategory
  );
}

main().catch((err: unknown) => {
  console.error('\nLive verification threw:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
