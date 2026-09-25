/**
 * Central provider-product -> canonical-category mapping.
 *
 * Every mapping lives here so a provider renaming a product is a one-file fix
 * (see docs/FAILURE_MODES.md §"Provider product naming changes"). Anything we
 * have not explicitly verified maps to OTHER rather than being guessed into
 * STANDARD, because a wrong STANDARD mapping puts a luxury car in the cheapest
 * comparison and misleads the user.
 */
import type { NormalizedCategory, ProviderId } from './quote';

interface ProductRule {
  /** Matched case-insensitively against the provider's product id or name. */
  match: RegExp;
  category: NormalizedCategory;
}

/**
 * Ordered: first match wins, so specific patterns precede general ones.
 *
 * A leading `\b` is deliberately avoided on tokens that providers glue onto a
 * brand prefix — "UberXL" has no word boundary before "XL", so `/\bxl\b/`
 * silently fails and the product falls through to OTHER. Trailing `\b` is
 * kept, which is what actually prevents "Deluxe" style false positives.
 */
const RULES: Readonly<Record<ProviderId, readonly ProductRule[]>> = {
  uber: [
    { match: /share\b/i, category: 'SHARED' },
    { match: /pool\b/i, category: 'SHARED' },
    { match: /wav\b|wheelchair|assist\b/i, category: 'ACCESSIBLE' },
    { match: /comfort electric\b|green\b|planet\b/i, category: 'EV' },
    { match: /black suv\b|suv\b/i, category: 'LUXURY' },
    { match: /black\b|lux\b|luxury\b|premier\b/i, category: 'LUXURY' },
    { match: /comfort\b/i, category: 'PREMIUM' },
    { match: /xl\b/i, category: 'XL' },
    { match: /taxi\b|cab\b/i, category: 'TAXI' },
    { match: /^uber\s*x$|^uberx$/i, category: 'STANDARD' },
  ],
  lyft: [
    { match: /shared\b|wait.*save\b/i, category: 'SHARED' },
    { match: /access\b|wheelchair/i, category: 'ACCESSIBLE' },
    { match: /black suv\b|luxsuv\b|suv\b/i, category: 'LUXURY' },
    { match: /black\b|lux\b|luxury\b/i, category: 'LUXURY' },
    { match: /extra comfort\b|preferred\b|comfort\b/i, category: 'PREMIUM' },
    { match: /xl\b/i, category: 'XL' },
    { match: /green\b|electric\b/i, category: 'EV' },
    { match: /^lyft$|standard\b/i, category: 'STANDARD' },
  ],
  empower: [
    // Premium XL is an XL vehicle first; the XL rule must win over Premium.
    { match: /xl\b/i, category: 'XL' },
    { match: /premium\b/i, category: 'PREMIUM' },
    { match: /everyday\b|standard\b/i, category: 'STANDARD' },
  ],
  curb: [
    { match: /wheelchair|wav\b|accessible\b/i, category: 'ACCESSIBLE' },
    { match: /suv\b|black\b/i, category: 'PREMIUM' },
    // Curb's core supply is licensed taxi. TAXI is its own category on purpose:
    // metered/regulated pricing is a different product from an app STANDARD car.
    { match: /taxi\b|cab\b|standard\b|curb\b/i, category: 'TAXI' },
  ],
  taxi: [
    { match: /wheelchair|wav\b|accessible\b/i, category: 'ACCESSIBLE' },
    // A regulated metered vehicle is its own product, never an app STANDARD car.
    { match: /.*/, category: 'TAXI' },
  ],
  bikeshare: [{ match: /.*/, category: 'BIKE' }],
  transit: [{ match: /.*/, category: 'TRANSIT' }],
  waymo: [{ match: /.*/, category: 'AUTONOMOUS' }],
  other: [],
};

export interface CategorizeInput {
  provider: ProviderId;
  productId: string;
  productName: string;
}

export function categorizeProduct(input: CategorizeInput): NormalizedCategory {
  const rules = RULES[input.provider] ?? [];
  const haystackName = input.productName.trim();
  const haystackId = input.productId.trim();
  for (const rule of rules) {
    if (rule.match.test(haystackName) || rule.match.test(haystackId)) return rule.category;
  }
  return 'OTHER';
}

/** Categories that belong in the default "sensible cheapest ride" comparison. */
export const STANDARD_VIEW_CATEGORIES: readonly NormalizedCategory[] = [
  'STANDARD',
  'ECONOMY',
  'TAXI',
];

/**
 * Modes that are not a car arriving at the kerb.
 *
 * Both are usually the cheapest thing on the screen and neither comes to the
 * door, so letting one win "cheapest ride" would turn a ride comparison into a
 * mode comparison without saying so. They are shown together, under their own
 * heading, with the walk or the drive to the platform stated on the card.
 */
export const OTHER_MODES: ReadonlySet<NormalizedCategory> = new Set(['BIKE', 'TRANSIT']);

/** Categories that must never silently appear beside a STANDARD car. */
export const SEGREGATED_CATEGORIES: readonly NormalizedCategory[] = [
  'XL',
  'PREMIUM',
  'LUXURY',
  'OTHER',
];

export const CATEGORY_LABELS: Readonly<Record<NormalizedCategory, string>> = {
  STANDARD: 'Standard',
  ECONOMY: 'Economy',
  TAXI: 'Taxi',
  XL: 'XL',
  PREMIUM: 'Premium',
  LUXURY: 'Luxury',
  EV: 'Electric',
  SHARED: 'Shared',
  ACCESSIBLE: 'Accessible',
  AUTONOMOUS: 'Autonomous',
  BIKE: 'Shared bike',
  TRANSIT: 'Train',
  OTHER: 'Other',
};
