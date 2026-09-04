import { getEnv, isProductionLiveCapable, resetEnvCache } from "../src/lib/config";
import { canonicalizeRoute } from "../src/lib/location/geocoder";
import { runQuoteSession } from "../src/lib/quotes/orchestrator";

async function main() {
  resetEnvCache();
  const env = getEnv();
  console.log("liveCapable:", isProductionLiveCapable(env));
  console.log("location:", env.LOCATION_PROVIDER);

  if (!isProductionLiveCapable(env)) {
    console.error(
      "No live sources configured. Set OBI_API_KEY/SECRET (recommended) or other partner credentials. See SETUP_REQUIRED.md",
    );
    process.exitCode = 2;
    return;
  }

  const route = await canonicalizeRoute({
    pickup: { query: "14 Prince Street, New York, NY" },
    destination: { query: "JFK Terminal 4, Queens, NY" },
  });

  console.log("pickup:", route.pickup.formattedAddress);
  console.log("destination:", route.destination.formattedAddress);

  const started = Date.now();
  const session = await runQuoteSession({
    pickup: route.pickup,
    destination: route.destination,
    skipCache: true,
  });

  console.log(
    JSON.stringify(
      {
        elapsedMs: Date.now() - started,
        status: session.status,
        coverage: session.coverage,
        quotes: session.quotes.map((q) => ({
          provider: q.provider,
          product: q.providerProductName,
          category: q.normalizedCategory,
          priceType: q.priceType,
          min: q.priceMinMinor,
          max: q.priceMaxMinor,
          eta: q.pickupEtaSeconds,
          freshness: q.freshness,
          source: q.source,
        })),
        discrepancies: session.discrepancies,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
