import { z } from "zod";

export const locationInputSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  query: z.string().min(1).max(500).optional(),
  placeId: z.string().max(200).optional(),
  formattedAddress: z.string().max(500).optional(),
});

export const compareRequestSchema = z.object({
  pickup: locationInputSchema,
  destination: locationInputSchema,
  rankingMode: z.enum(["cheapest", "fastest", "best_value"]).optional(),
  categoryFilter: z
    .union([
      z.literal("ALL"),
      z.literal("standard"),
      z.array(
        z.enum([
          "STANDARD",
          "ECONOMY",
          "TAXI",
          "XL",
          "PREMIUM",
          "LUXURY",
          "EV",
          "SHARED",
          "ACCESSIBLE",
          "AUTONOMOUS",
          "OTHER",
        ]),
      ),
    ])
    .optional(),
  stream: z.boolean().optional(),
  refresh: z.boolean().optional(),
});

export const placesQuerySchema = z.object({
  q: z.string().min(1).max(200),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});
