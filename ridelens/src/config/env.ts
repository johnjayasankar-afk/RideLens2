/**
 * Single, validated view of configuration.
 *
 * Two hard rules enforced here:
 *  1. Fixture/demo data can NEVER be served by a production deployment.
 *     RIDELENS_DEMO_SOURCE is ignored unless NODE_ENV !== 'production'.
 *  2. A production deployment with no live quote source is a misconfiguration
 *     we report loudly rather than paper over.
 */
import { z } from 'zod';

const optionalSecret = z.string().trim().min(1).optional().catch(undefined);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // --- Persistence -------------------------------------------------------
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().catch(undefined),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,

  // --- Quote sources -----------------------------------------------------
  OBI_API_KEY: optionalSecret,
  OBI_API_BASE_URL: z.string().url().optional().catch(undefined),

  UBER_CLIENT_ID: optionalSecret,
  UBER_CLIENT_SECRET: optionalSecret,
  UBER_SERVER_TOKEN: optionalSecret,
  /**
   * Uber's API Terms of Use §II B prohibit using the Uber API in a product
   * that compares Uber against competing services. The direct Uber quote
   * adapter therefore stays off unless an operator asserts, in configuration,
   * that they hold written rights permitting it. See docs/DATA_SOURCE_MATRIX.md.
   */
  UBER_COMPARISON_RIGHTS_GRANTED: z.enum(['true', 'false']).default('false'),
  /** Free developer client_id used only for booking deep links, not quotes. */
  UBER_DEEPLINK_CLIENT_ID: optionalSecret,

  LYFT_CLIENT_ID: optionalSecret,
  LYFT_CLIENT_SECRET: optionalSecret,
  LYFT_API_BASE_URL: z.string().url().optional().catch(undefined),

  EMPOWER_API_KEY: optionalSecret,
  EMPOWER_API_BASE_URL: z.string().url().optional().catch(undefined),

  CURB_API_KEY: optionalSecret,
  CURB_API_BASE_URL: z.string().url().optional().catch(undefined),

  // --- Location ----------------------------------------------------------
  /**
   * 'auto' picks the best configured provider: google > mapbox > osm.
   * 'osm' (Nominatim + Photon) needs no key and is permitted for low-volume
   * use under the OSMF policy, so RideLens has a working geocoder out of the box.
   */
  GEOCODER_PROVIDER: z.enum(['auto', 'google', 'mapbox', 'osm', 'fixture']).default('auto'),
  LOCATION_PROVIDER_API_KEY: optionalSecret,
  NEXT_PUBLIC_MAP_KEY: optionalSecret,
  /** Contact string sent in User-Agent to Nominatim/Photon, per their policy. */
  OSM_CONTACT_EMAIL: optionalSecret,
  /** Optional route geometry for the map. Distinct from provider trip duration. */
  ENABLE_ROUTE_GEOMETRY: z.enum(['true', 'false']).default('true'),
  /**
   * Routing service used to measure a route. Defaults to the public OSRM
   * instance, which is fine for development and light use; point this at a
   * self-hosted or commercial router before carrying real traffic.
   */
  ROUTING_BASE_URL: z.string().url().optional().catch(undefined),
  /**
   * Pedestrian router, used to measure the walk to and from a platform. Kept
   * separate from ROUTING_BASE_URL because the OSRM demo server that answers
   * that one has only the car profile loaded and returns driving times for a
   * walking request — 31 km/h on the leg this was written for. Defaults to the
   * public Valhalla instance, which really does have a pedestrian graph.
   */
  WALKING_BASE_URL: z.string().url().optional().catch(undefined),
  /**
   * Regulated taxi rate cards. On by default because they need no credential
   * and the published tariff is public data — set 'false' to suppress them.
   */
  ENABLE_PUBLIC_RATE_CARD: z.enum(['true', 'false']).default('true'),
  /**
   * Bike-share quotes from open GBFS feeds. On by default: GBFS exists to be
   * read by trip planners, needs no credential, and is the most genuinely
   * real-time data RideLens has.
   */
  ENABLE_BIKE_SHARE: z.enum(['true', 'false']).default('true'),
  /**
   * Regional-rail fares from published zone tables. On by default for the same
   * reason as the rate cards: the fare is public, fixed by the authority, and
   * for a trip that starts outside a taxi jurisdiction it is often the only
   * price that legitimately exists.
   */
  ENABLE_REGIONAL_RAIL: z.enum(['true', 'false']).default('true'),

  // --- Behaviour ---------------------------------------------------------
  QUOTE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(120).default(20),
  QUOTE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(30),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(300),

  UPSTASH_REDIS_REST_URL: z.string().url().optional().catch(undefined),
  UPSTASH_REDIS_REST_TOKEN: optionalSecret,

  /** 32-byte base64 key for encrypting stored OAuth tokens at rest. */
  TOKEN_ENCRYPTION_KEY: optionalSecret,

  // --- Non-production only ----------------------------------------------
  RIDELENS_DEMO_SOURCE: z.enum(['enabled', 'disabled']).default('disabled'),
  RIDELENS_E2E: z.string().optional().catch(undefined),
});

export type RawEnv = z.infer<typeof EnvSchema>;

export interface AppConfig extends RawEnv {
  isProduction: boolean;
  /** True only when fixtures are BOTH requested and permitted. */
  demoSourceActive: boolean;
  geocoderProvider: 'google' | 'mapbox' | 'osm' | 'fixture';
  persistence: 'supabase' | 'memory';
  rateLimiter: 'upstash' | 'supabase' | 'memory';
}

let cached: AppConfig | null = null;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid RideLens configuration — ${issues}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';

  // Rule 1: fixtures are structurally impossible in production.
  const demoSourceActive = env.RIDELENS_DEMO_SOURCE === 'enabled' && !isProduction;

  const geocoderProvider = resolveGeocoder(env, isProduction);

  const persistence: AppConfig['persistence'] =
    env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'memory';

  const rateLimiter: AppConfig['rateLimiter'] = env.UPSTASH_REDIS_REST_URL
    ? 'upstash'
    : persistence === 'supabase'
      ? 'supabase'
      : 'memory';

  return { ...env, isProduction, demoSourceActive, geocoderProvider, persistence, rateLimiter };
}

function resolveGeocoder(env: RawEnv, isProduction: boolean): AppConfig['geocoderProvider'] {
  if (env.GEOCODER_PROVIDER === 'fixture') {
    if (isProduction) {
      throw new Error('GEOCODER_PROVIDER=fixture is not permitted in production.');
    }
    return 'fixture';
  }
  if (env.GEOCODER_PROVIDER !== 'auto') return env.GEOCODER_PROVIDER;
  if (env.LOCATION_PROVIDER_API_KEY) {
    // A single key is supplied; the operator picks which platform it belongs to.
    return env.NEXT_PUBLIC_MAP_KEY?.startsWith('pk.') ? 'mapbox' : 'google';
  }
  return 'osm';
}

export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test-only. */
export function resetConfigCache(): void {
  cached = null;
}

export interface StartupCheck {
  level: 'ok' | 'warn' | 'error';
  code: string;
  message: string;
}

/**
 * Run at boot and surfaced on /api/health. A production deployment that would
 * serve fixture data, or that has no live source at all, is reported as an
 * error rather than quietly pretending to be live.
 */
export function startupChecks(cfg: AppConfig, enabledLiveSourceCount: number): StartupCheck[] {
  const checks: StartupCheck[] = [];

  if (cfg.isProduction && cfg.RIDELENS_DEMO_SOURCE === 'enabled') {
    checks.push({
      level: 'error',
      code: 'DEMO_SOURCE_IN_PRODUCTION',
      message:
        'RIDELENS_DEMO_SOURCE=enabled was set in a production build. Fixture data is refused; the flag has been ignored.',
    });
  }

  if (enabledLiveSourceCount === 0) {
    checks.push({
      level: cfg.isProduction ? 'error' : 'warn',
      code: 'NO_LIVE_QUOTE_SOURCE',
      message:
        'No live quote source is configured. RideLens will report every provider as unavailable rather than display any price. See SETUP_REQUIRED.md.',
    });
  }

  if (cfg.isProduction && cfg.persistence === 'memory') {
    checks.push({
      level: 'error',
      code: 'NO_DURABLE_PERSISTENCE',
      message: 'Production requires Supabase. In-memory persistence loses sessions on restart.',
    });
  }

  if (cfg.isProduction && cfg.rateLimiter === 'memory') {
    checks.push({
      level: 'error',
      code: 'NO_DURABLE_RATE_LIMITER',
      message: 'Production requires a durable rate limiter (Upstash or Supabase).',
    });
  }

  if (cfg.geocoderProvider === 'osm') {
    checks.push({
      level: 'warn',
      code: 'KEYLESS_GEOCODER',
      message:
        'Using the keyless OSM geocoder (Nominatim/Photon). Live and permitted for low volume, but rate-limited to ~1 req/s and unsuitable for consumer scale. Set LOCATION_PROVIDER_API_KEY for Google or Mapbox.',
    });
  }

  if (!cfg.TOKEN_ENCRYPTION_KEY) {
    checks.push({
      level: 'warn',
      code: 'NO_TOKEN_ENCRYPTION_KEY',
      message: 'TOKEN_ENCRYPTION_KEY is unset. Provider account linking is disabled.',
    });
  }

  return checks;
}
