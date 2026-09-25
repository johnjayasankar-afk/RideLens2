/**
 * The compare request, defined once.
 *
 * `/api/quotes` and `/api/quotes/stream` accept the same body and must keep
 * accepting the same body — they had drifted apart already, and a field added
 * to one silently did nothing on the other.
 */
import { z } from 'zod';
import { LocationInputSchema } from '@/location/canonical';

export const CompareRequestSchema = z.object({
  pickup: LocationInputSchema,
  destination: LocationInputSchema,
  locale: z.string().max(20).optional(),
  refresh: z.boolean().optional(),
  /**
   * Part of the price in Chicago and DC, which publish a per-passenger charge.
   * Capped at the largest party the product offers.
   */
  partySize: z.number().int().min(1).max(6).optional(),
  /**
   * Price the trip for this instant rather than now, as an ISO timestamp.
   *
   * Honoured only by sources whose price is a published rule. The horizon is
   * capped because a projection is only as good as the rate card behind it: a
   * tariff is changed by rulemaking, and the further out the answer, the more
   * likely the card it came from has been superseded. Thirty days is well
   * inside the re-verification cadence the cards already carry.
   */
  departAt: z
    .string()
    .datetime({ offset: true })
    .refine((iso) => {
      const t = Date.parse(iso);
      const now = Date.now();
      return t >= now - PAST_TOLERANCE_MS && t <= now + SCHEDULE_HORIZON_MS;
    }, 'A departure must be in the next 30 days.')
    .optional(),
});

/** How far ahead a fare may be projected. See `departAt`. */
export const SCHEDULE_HORIZON_DAYS = 30;
const SCHEDULE_HORIZON_MS = SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000;
/** Clock skew between the rider's device and the server; not a way to backdate. */
const PAST_TOLERANCE_MS = 5 * 60 * 1000;

export type CompareRequest = z.infer<typeof CompareRequestSchema>;
