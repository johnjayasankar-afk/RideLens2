-- Persisted quote sessions.
--
-- The orchestrator held sessions in a module-level Map, so on Vercel a request
-- routed to a different instance than the one that ran the comparison got
-- "Session not found". Everything that retrieves a past session — shared
-- links, the admin's recent list, the reported-actual capture — was unreliable
-- in production and reliable in development, which is the worst combination.
--
-- quote_sessions already existed but stored only the envelope. The quotes
-- themselves, the discrepancies and the filter were never written, so a row
-- could not reconstruct what the rider saw.

alter table quote_sessions
  add column if not exists quotes jsonb not null default '[]'::jsonb,
  add column if not exists discrepancies jsonb not null default '[]'::jsonb,
  add column if not exists category_filter jsonb,
  -- A session is a snapshot of prices that move on a ~55s tick. It is worth
  -- keeping long enough to open a shared link and report an actual fare
  -- against, and not worth keeping forever.
  add column if not exists expires_at timestamptz not null default (now() + interval '30 days');

create index if not exists quote_sessions_created_at_idx
  on quote_sessions (created_at desc);

create index if not exists quote_sessions_expires_at_idx
  on quote_sessions (expires_at);

-- Reported actual fares: the ground truth the calibration harness scores
-- against. One row per ride somebody told us about.
create table if not exists reported_actuals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references quote_sessions(id) on delete set null,
  -- Kept independently of the session so a report survives its expiry.
  route_hash text not null,
  provider text not null,
  product_id text,
  market_id text,
  -- What we predicted, in minor units, at the moment we predicted it.
  predicted_min_minor integer not null,
  predicted_max_minor integer not null,
  predicted_at timestamptz not null,
  model_version text,
  -- What they actually paid.
  actual_minor integer not null,
  currency text not null default 'USD',
  reported_at timestamptz not null default now(),
  -- Free-text, never required, never shown to anyone else.
  note text
);

create index if not exists reported_actuals_route_idx on reported_actuals (route_hash);
create index if not exists reported_actuals_provider_idx on reported_actuals (provider);
create index if not exists reported_actuals_reported_at_idx on reported_actuals (reported_at desc);

alter table reported_actuals enable row level security;
