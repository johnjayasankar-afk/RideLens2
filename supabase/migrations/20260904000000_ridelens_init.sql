-- RideLens initial schema
create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists connected_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null,
  access_token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  scopes text,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists quote_sessions (
  id uuid primary key,
  user_id uuid references profiles(id) on delete set null,
  status text not null,
  pickup jsonb not null,
  destination jsonb not null,
  ranking_mode text not null default 'cheapest',
  coverage jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists provider_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references quote_sessions(id) on delete cascade,
  source_id text not null,
  ok boolean not null,
  latency_ms integer,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists provider_requests_session_idx on provider_requests(session_id);

create table if not exists quotes (
  id uuid primary key,
  session_id uuid not null references quote_sessions(id) on delete cascade,
  provider text not null,
  payload jsonb not null,
  is_canonical boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists quotes_session_idx on quotes(session_id);

create table if not exists source_discrepancies (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references quote_sessions(id) on delete cascade,
  provider text not null,
  delta_minor integer not null,
  message text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists booking_handoff_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references quote_sessions(id) on delete set null,
  user_id uuid references profiles(id) on delete set null,
  provider text not null,
  url_host text not null,
  created_at timestamptz not null default now()
);

create table if not exists recent_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  pickup jsonb not null,
  destination jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists recent_searches_user_idx on recent_searches(user_id, created_at desc);

create table if not exists provider_health_events (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  status text not null,
  latency_ms integer,
  detail text,
  created_at timestamptz not null default now()
);

create table if not exists api_usage_daily (
  day date primary key,
  comparisons integer not null default 0,
  source_calls integer not null default 0,
  source_errors integer not null default 0,
  cache_hits integer not null default 0,
  estimated_cost_usd numeric(10,4) not null default 0
);

create table if not exists provider_configuration (
  source_id text primary key,
  enabled boolean not null default false,
  notes text,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table connected_provider_accounts enable row level security;
alter table quote_sessions enable row level security;
alter table recent_searches enable row level security;
alter table booking_handoff_events enable row level security;

create policy "profiles_self" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "connected_self" on connected_provider_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "sessions_read_own_or_anon" on quote_sessions
  for select using (user_id is null or auth.uid() = user_id);

create policy "recent_self" on recent_searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "handoff_self" on booking_handoff_events
  for select using (user_id is null or auth.uid() = user_id);
