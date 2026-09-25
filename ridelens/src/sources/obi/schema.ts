/**
 * Obi Intelligent Pricing API — response contract.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VERIFICATION STATUS: UNVERIFIED AGAINST VENDOR DOCUMENTATION.            │
 * │ Obi does not publish the Intelligent Pricing API schema publicly; access │
 * │ is granted under a commercial agreement (see SETUP_REQUIRED.md).        │
 * │ This schema is written permissively so that a real response is accepted  │
 * │ with a field-name mapping change confined to this one file. Run          │
 * │ `npm run verify:live -- --dump obi` with a key to capture the real       │
 * │ payload, then tighten the schema against it.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Nothing downstream of this file knows Obi's field names.
 */
import { z } from 'zod';

/** Accept both cents-style integers and decimal strings; money is parsed later. */
const Amount = z.union([z.number(), z.string()]);

const ObiPrice = z
  .object({
    // Point price
    amount: Amount.nullish(),
    // Range
    low: Amount.nullish(),
    high: Amount.nullish(),
    min: Amount.nullish(),
    max: Amount.nullish(),
    currency: z.string().min(3).max(3).nullish(),
    currency_code: z.string().min(3).max(3).nullish(),
    /** Vendor's own semantics label, if supplied. */
    type: z.string().nullish(),
    is_upfront: z.boolean().nullish(),
  })
  .passthrough();

export const ObiProductSchema = z
  .object({
    provider: z.string().min(1),
    product_id: z.string().nullish(),
    id: z.string().nullish(),
    product_name: z.string().nullish(),
    name: z.string().nullish(),
    display_name: z.string().nullish(),

    price: ObiPrice.nullish(),
    // Some feeds flatten price onto the product.
    price_low: Amount.nullish(),
    price_high: Amount.nullish(),
    price_amount: Amount.nullish(),
    currency: z.string().min(3).max(3).nullish(),

    eta_seconds: z.number().nullish(),
    pickup_eta_seconds: z.number().nullish(),
    eta_minutes: z.number().nullish(),

    duration_seconds: z.number().nullish(),
    trip_duration_seconds: z.number().nullish(),
    distance_meters: z.number().nullish(),

    available: z.boolean().nullish(),
    is_available: z.boolean().nullish(),

    surge_multiplier: z.number().nullish(),
    booking_url: z.string().nullish(),
    deep_link: z.string().nullish(),

    expires_at: z.string().nullish(),
    quoted_at: z.string().nullish(),
  })
  .passthrough();

export const ObiQuoteResponseSchema = z
  .object({
    // Different feeds nest the list differently; accept the common shapes.
    results: z.array(ObiProductSchema).nullish(),
    products: z.array(ObiProductSchema).nullish(),
    quotes: z.array(ObiProductSchema).nullish(),
    data: z.array(ObiProductSchema).nullish(),
    timestamp: z.string().nullish(),
    request_id: z.string().nullish(),
  })
  .passthrough();

export type ObiProduct = z.infer<typeof ObiProductSchema>;
export type ObiQuoteResponse = z.infer<typeof ObiQuoteResponseSchema>;

/** Pull the product list out of whichever envelope key the feed used. */
export function extractProducts(res: ObiQuoteResponse): ObiProduct[] {
  return res.results ?? res.products ?? res.quotes ?? res.data ?? [];
}

/** Obi provider strings -> RideLens provider ids. Extend as coverage grows. */
export const OBI_PROVIDER_MAP: Readonly<Record<string, string>> = {
  uber: 'uber',
  lyft: 'lyft',
  empower: 'empower',
  curb: 'curb',
  waymo: 'waymo',
  'curb taxi': 'curb',
  taxi: 'curb',
};
