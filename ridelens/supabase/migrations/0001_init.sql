-- RideLens core schema.
--
-- Location privacy shapes this schema (docs/SECURITY.md §Location privacy):
--   * quote_sessions stores COARSE coordinates only (~1 km, numeric(6,2)).
--   * Exact coordinates live only in the request/response cycle and in
--     recent_searches, which is user-owned and user-deletable.
--   * provider_requests records latency and status, never route detail.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  home_label    text,
  work_label    text,
  locale        text not null default 'en-US',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ------------------------------------------- connected_provider_accounts
-- OAuth tokens are stored ENCRYPTED (AES-256-GCM) by the application layer.
-- The database never sees plaintext, and no client role can select these rows.
create table if not exists public.connected_provider_accounts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  provider             text not null check (provider in ('uber','lyft','empower','curb','waymo')),
  provider_account_ref text,
  access_token_enc     text not null,
  refresh_token_enc    text,
  scopes               text[] not null default '{}',
  expires_at           timestamptz,
  revoked_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, provider)
);

-- --------------------------------------------------------- quote_sessions
create table if not exists public.quote_sessions (
  id                    text primary key,
  user_id               uuid references auth.users (id) on delete set null,
  -- Anonymous sessions are keyed by a rotating client token, not an identity.
  anon_key              text,
  status                text not null check (status in ('PENDING','RUNNING','PARTIAL','SUCCESS','FAILED')),
  -- Coarse only. numeric(6,2) cannot physically hold a precise coordinate.
  pickup_lat_coarse     numeric(6,2),
  pickup_lng_coarse     numeric(6,2),
  dest_lat_coarse       numeric(6,2),
  dest_lng_coarse       numeric(6,2),
  pickup_city           text,
  dest_city             text,
  geocoder              text,
  locale                text not null default 'en-US',
  sources_expected      text[] not null default '{}',
  sources_succeeded     text[] not null default '{}',
  sources_failed        text[] not null default '{}',
  providers_returned    text[] not null default '{}',
  quote_count           integer not null default 0,
  total_latency_ms      integer,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

create index if not exists quote_sessions_user_created_idx
  on public.quote_sessions (user_id, created_at desc);
create index if not exists quote_sessions_created_idx
  on public.quote_sessions (created_at desc);

-- ------------------------------------------------------ provider_requests
create table if not exists public.provider_requests (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null references public.quote_sessions (id) on delete cascade,
  source_id    text not null,
  status       text not null check (status in ('OK','TIMEOUT','ERROR','SKIPPED','UNAUTHORIZED','RATE_LIMITED')),
  latency_ms   integer,
  quote_count  integer not null default 0,
  cache_hit    boolean not null default false,
  blocker_code text,
  message      text,
  created_at   timestamptz not null default now()
);

create index if not exists provider_requests_session_idx on public.provider_requests (session_id);
create index if not exists provider_requests_source_created_idx
  on public.provider_requests (source_id, created_at desc);

-- ------------------------------------------------------------------ quotes
create table if not exists public.quotes (
  id                     uuid primary key default gen_random_uuid(),
  session_id             text not null references public.quote_sessions (id) on delete cascade,
  quote_key              text not null,
  provider               text not null,
  provider_product_id    text not null,
  provider_product_name  text not null,
  normalized_category    text not null,
  price_type             text not null check (price_type in ('UPFRONT_QUOTE','ESTIMATE','ESTIMATE_RANGE','METERED_ESTIMATE','UNKNOWN')),
  price_min_minor        bigint not null,
  price_max_minor        bigint not null,
  display_price_minor    bigint not null,
  ranking_price_minor    bigint not null,
  currency               text not null,
  pickup_eta_seconds     integer,
  trip_duration_seconds  integer,
  distance_meters        integer,
  availability           text not null check (availability in ('AVAILABLE','UNAVAILABLE','UNKNOWN')),
  source                 text not null,
  source_method          text not null,
  account_context        text not null check (account_context in ('PUBLIC','ACCOUNT_LINKED','UNKNOWN')),
  confidence_class       text not null,
  is_canonical           boolean not null default false,
  received_at            timestamptz not null,
  provider_timestamp     timestamptz,
  expires_at             timestamptz,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);

create index if not exists quotes_session_idx on public.quotes (session_id);
create index if not exists quotes_provider_created_idx on public.quotes (provider, created_at desc);

-- ------------------------------------------------- source_discrepancies
create table if not exists public.source_discrepancies (
  id                   uuid primary key default gen_random_uuid(),
  session_id           text not null references public.quote_sessions (id) on delete cascade,
  provider             text not null,
  normalized_category  text not null,
  canonical_quote_key  text not null,
  conflicting_keys     text[] not null default '{}',
  spread_minor         bigint not null,
  spread_bps           integer not null,
  currency             text not null,
  severity             text not null check (severity in ('MINOR','MATERIAL')),
  created_at           timestamptz not null default now()
);

create index if not exists source_discrepancies_created_idx
  on public.source_discrepancies (created_at desc);

-- ---------------------------------------------- booking_handoff_events
create table if not exists public.booking_handoff_events (
  id                   uuid primary key default gen_random_uuid(),
  session_id           text references public.quote_sessions (id) on delete set null,
  user_id              uuid references auth.users (id) on delete set null,
  provider             text not null,
  quote_key            text not null,
  handoff_kind         text not null check (handoff_kind in ('PREFILLED_DEEPLINK','PARTIAL_DEEPLINK','GENERIC')),
  -- Host only. Full URLs contain coordinates and are not retained.
  destination_host     text not null,
  observed_price_minor bigint,
  currency             text,
  quote_age_ms         integer,
  created_at           timestamptz not null default now()
);

create index if not exists booking_handoff_provider_idx
  on public.booking_handoff_events (provider, created_at desc);

-- -------------------------------------------------------- recent_searches
-- User-owned and user-deletable. This is the only table holding precise
-- coordinates, and only for signed-in users who performed the search.
create table if not exists public.recent_searches (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  pickup_label       text not null,
  pickup_lat         double precision not null,
  pickup_lng         double precision not null,
  dest_label         text not null,
  dest_lat           double precision not null,
  dest_lng           double precision not null,
  created_at         timestamptz not null default now()
);

create index if not exists recent_searches_user_idx
  on public.recent_searches (user_id, created_at desc);

-- -------------------------------------------------- provider_health_events
create table if not exists public.provider_health_events (
  id           uuid primary key default gen_random_uuid(),
  source_id    text not null,
  status       text not null,
  detail       text,
  blocker_code text,
  latency_ms   integer,
  created_at   timestamptz not null default now()
);

create index if not exists provider_health_source_idx
  on public.provider_health_events (source_id, created_at desc);

-- ------------------------------------------------------- api_usage_daily
create table if not exists public.api_usage_daily (
  day                  date not null,
  source_id            text not null,
  calls                bigint not null default 0,
  cache_hits           bigint not null default 0,
  errors               bigint not null default 0,
  timeouts             bigint not null default 0,
  rate_limited         bigint not null default 0,
  p50_latency_ms       integer,
  p95_latency_ms       integer,
  estimated_cost_minor bigint not null default 0,
  primary key (day, source_id)
);

-- -------------------------------------------------- provider_configuration
-- Operator-editable overrides read at request time; secrets stay in env.
create table if not exists public.provider_configuration (
  source_id         text primary key,
  enabled_override  boolean,
  cache_ttl_seconds integer,
  notes             text,
  updated_at        timestamptz not null default now()
);
