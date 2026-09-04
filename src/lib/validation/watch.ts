import { z } from "zod";

export const createWatchSchema = z.object({
  originCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3}$/, "Origin must be a 3-character station code"),
  destinationCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3}$/, "Destination must be a 3-character station code"),
  desiredTravelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Desired date must be YYYY-MM-DD"),
  dateFlexibilityDays: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
  preferredDepartureTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .nullable()
    .optional(),
  passengerCount: z.number().int().min(1).max(8).default(1),
  currentBookedPriceCents: z.number().int().min(100).max(10_000_000),
  bookedTrainNumber: z.string().trim().max(16).nullable().optional(),
  bookedDepartureAt: z.string().nullable().optional(),
  bookedFareFamily: z
    .enum(["FLEXIBLE", "VALUE", "SAVER", "PREMIUM", "OTHER", "UNKNOWN"])
    .default("FLEXIBLE"),
  travelClass: z
    .enum(["COACH", "BUSINESS", "FIRST", "SLEEPER", "OTHER", "UNKNOWN"])
    .default("COACH"),
  includeRestrictedFares: z.boolean().default(false),
  includeThruway: z.boolean().default(false),
  minimumSavingsCents: z.number().int().min(100).max(100_000).default(100),
  bookedAt: z.string().datetime().optional(),
  monitorPreset: z.enum(["24h", "48h", "72h", "until_departure", "custom"]).default("48h"),
  customMonitorEndAt: z.string().datetime().nullable().optional(),
  timezone: z.string().default("America/New_York"),
  alertEmail: z.string().email().nullable().optional(),
});

export const rebookSchema = z.object({
  newBookedPriceCents: z.number().int().min(100).max(10_000_000),
  newDesiredTravelDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  newTrainNumber: z.string().trim().max(16).nullable().optional(),
  newDepartureAt: z.string().nullable().optional(),
  newFareFamily: z
    .enum(["FLEXIBLE", "VALUE", "SAVER", "PREMIUM", "OTHER", "UNKNOWN"])
    .nullable()
    .optional(),
  updateDesiredDate: z.boolean().default(false),
});

export const stationQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
});

export type CreateWatchInput = z.infer<typeof createWatchSchema>;
export type RebookInput = z.infer<typeof rebookSchema>;
