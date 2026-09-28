/**
 * Which quotes this model is allowed to re-run.
 *
 * Two endpoints ask the same question — the departure forecast projects a
 * quote forward in time, the sensitivity report re-runs it at perturbed
 * inputs — and both need the same answer: only a fare this engine computed can
 * be recomputed by it.
 *
 * That is not a limitation to work around. A partner's quote is a price they
 * are holding for the next few minutes; extrapolating it to 6pm, or to "if the
 * drive runs 25% longer", would be putting words in their mouth. The filter is
 * a refusal, and it is written once so the two refusals cannot drift apart.
 */

import type { NormalizedQuote } from "@/lib/domain/types";
import type { FareProduct } from "@/lib/sources/ratecard/fare-engine";
import type {
  MarketplaceProduct,
  MarketplaceProvider,
} from "@/lib/sources/ratecard/marketplace-dynamics";

const PROVIDERS = new Set<MarketplaceProvider>(["uber", "lyft", "empower", "curb"]);
const PRODUCTS = new Set<MarketplaceProduct>([
  "uberx",
  "comfort",
  "uberxl",
  "lyft",
  "lyft_xl",
  "taxi",
  "empower",
]);

/** Everything the fare engine needs, recovered from a quote it produced. */
export interface ReplayableQuote {
  quoteId: string;
  label: string;
  provider: MarketplaceProvider;
  product: FareProduct;
  /** The quote's own category, for the wait model the forecast also runs. */
  category: string;
  miles: number;
  osrmMinutes: number;
  weatherSurgeLift: number | undefined;
  /** What the rider is looking at, so a report can be measured against it. */
  bandLowDollars: number;
  bandHighDollars: number;
}

/**
 * Returns null for anything this engine did not price, or priced without the
 * distance and duration a re-run needs.
 */
export function replayable(quote: NormalizedQuote): ReplayableQuote | null {
  if (quote.source !== "public_rate_card") return null;

  const provider = quote.provider as MarketplaceProvider;
  if (!PROVIDERS.has(provider)) return null;

  const product = quote.metadata?.fareProduct as MarketplaceProduct | undefined;
  if (!product || !PRODUCTS.has(product)) return null;

  const meters = quote.distanceMeters;
  const seconds = quote.tripDurationSeconds;
  if (!meters || !seconds) return null;

  return {
    quoteId: quote.id,
    label: quote.providerProductName || quote.provider,
    provider,
    product: product as FareProduct,
    category: quote.normalizedCategory,
    miles: meters / 1609.344,
    osrmMinutes: seconds / 60,
    weatherSurgeLift: quote.metadata?.weatherSurgeLift as number | undefined,
    bandLowDollars: quote.priceMinMinor / 100,
    bandHighDollars: quote.priceMaxMinor / 100,
  };
}

/**
 * One entry per product, not per quote.
 *
 * Two quotes for the same product produce identical results and double the
 * work; the forecast learned this first, drawing the same curve twice.
 */
export function replayableProducts(quotes: readonly NormalizedQuote[]): {
  items: ReplayableQuote[];
  skipped: number;
} {
  const seen = new Set<string>();
  const items: ReplayableQuote[] = [];
  let skipped = 0;
  for (const quote of quotes) {
    const item = replayable(quote);
    if (!item) {
      skipped += 1;
      continue;
    }
    const key = `${item.provider}:${item.product}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return { items, skipped };
}
