import { z } from "zod";

const emptyToUndefined = (v: unknown) =>
  v === "" || v === undefined || v === null ? undefined : v;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().url().optional(),
);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  OBI_API_KEY: optionalString,
  OBI_API_SECRET: optionalString,
  OBI_API_BASE_URL: z
    .string()
    .default("https://api.obifareai.com"),

  UBER_CLIENT_ID: optionalString,
  UBER_CLIENT_SECRET: optionalString,
  UBER_COMPARISON_AUTHORIZED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  LYFT_CLIENT_ID: optionalString,
  LYFT_CLIENT_SECRET: optionalString,
  LYFT_COMPARISON_AUTHORIZED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  EMPOWER_API_KEY: optionalString,
  EMPOWER_API_BASE_URL: optionalUrl,

  CURB_API_KEY: optionalString,
  CURB_API_BASE_URL: optionalUrl,

  LOCATION_PROVIDER: z
    .enum(["mapbox", "google", "nominatim", "photon"])
    .default("photon"),
  LOCATION_PROVIDER_API_KEY: optionalString,
  NEXT_PUBLIC_MAP_KEY: optionalString,

  QUOTE_CACHE_TTL_SECONDS: z.coerce.number().default(20),
  QUOTE_REQUEST_TIMEOUT_MS: z.coerce.number().default(8000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(30),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),

  RIDELENS_ALLOW_FIXTURES: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  RIDELENS_ADMIN_SECRET: optionalString,

  /** Keyless live path: OSRM + published rate cards. Default on. */
  RATE_CARD_SOURCE_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null ? true : v !== "false")),
  OSRM_BASE_URL: z.string().default("https://router.project-osrm.org"),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  cached = envSchema.parse(process.env);
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export function obiConfigured(env: AppEnv = getEnv()): boolean {
  return Boolean(env.OBI_API_KEY && env.OBI_API_SECRET);
}

export function lyftConfigured(env: AppEnv = getEnv()): boolean {
  return Boolean(
    env.LYFT_CLIENT_ID &&
      env.LYFT_CLIENT_SECRET &&
      env.LYFT_COMPARISON_AUTHORIZED,
  );
}

export function uberComparisonAuthorized(env: AppEnv = getEnv()): boolean {
  return Boolean(
    env.UBER_COMPARISON_AUTHORIZED &&
      env.UBER_CLIENT_ID &&
      env.UBER_CLIENT_SECRET,
  );
}

export function curbConfigured(env: AppEnv = getEnv()): boolean {
  return Boolean(env.CURB_API_KEY && env.CURB_API_BASE_URL);
}

export function empowerConfigured(env: AppEnv = getEnv()): boolean {
  return Boolean(env.EMPOWER_API_KEY && env.EMPOWER_API_BASE_URL);
}

export function fixturesAllowed(env: AppEnv = getEnv()): boolean {
  if (env.NODE_ENV === "production") return false;
  return Boolean(env.RIDELENS_ALLOW_FIXTURES);
}

export function rateCardConfigured(env: AppEnv = getEnv()): boolean {
  return env.RATE_CARD_SOURCE_ENABLED !== false;
}

/** At least one legitimate live quote path is configured. */
export function isProductionLiveCapable(env: AppEnv = getEnv()): boolean {
  return (
    rateCardConfigured(env) ||
    obiConfigured(env) ||
    lyftConfigured(env) ||
    curbConfigured(env) ||
    empowerConfigured(env) ||
    uberComparisonAuthorized(env)
  );
}

export function assertNoSilentMocks(env: AppEnv = getEnv()): void {
  if (env.NODE_ENV === "production" && env.RIDELENS_ALLOW_FIXTURES) {
    throw new Error(
      "RIDELENS_ALLOW_FIXTURES must never be enabled in production.",
    );
  }
}
