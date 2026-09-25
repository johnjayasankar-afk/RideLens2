-- Row Level Security.
--
-- Default posture: every table is locked, and the anon/authenticated roles get
-- exactly the grants a rider needs — their own rows and nothing else.
-- Operational tables are service-role only; the admin dashboard reads them
-- through a server route that holds the service key, never from the browser.

alter table public.profiles                    enable row level security;
alter table public.connected_provider_accounts enable row level security;
alter table public.quote_sessions              enable row level security;
alter table public.provider_requests           enable row level security;
alter table public.quotes                      enable row level security;
alter table public.source_discrepancies        enable row level security;
alter table public.booking_handoff_events      enable row level security;
alter table public.recent_searches             enable row level security;
alter table public.provider_health_events      enable row level security;
alter table public.api_usage_daily             enable row level security;
alter table public.provider_configuration      enable row level security;

-- profiles: a user sees and edits only their own row.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_upsert_own on public.profiles;
create policy profiles_upsert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- connected_provider_accounts: readable by the owner so the UI can show
-- "Connected", but the encrypted token columns are never exposed to a client
-- because all reads go through a server route. No client INSERT/UPDATE at all:
-- tokens are written only by the service role after an OAuth exchange.
drop policy if exists cpa_select_own on public.connected_provider_accounts;
create policy cpa_select_own on public.connected_provider_accounts
  for select using (auth.uid() = user_id);

drop policy if exists cpa_delete_own on public.connected_provider_accounts;
create policy cpa_delete_own on public.connected_provider_accounts
  for delete using (auth.uid() = user_id);

-- quote_sessions: owner-only reads. Anonymous sessions have user_id null and
-- are readable only via the service role, so one anonymous visitor can never
-- enumerate another's sessions.
drop policy if exists quote_sessions_select_own on public.quote_sessions;
create policy quote_sessions_select_own on public.quote_sessions
  for select using (auth.uid() is not null and auth.uid() = user_id);

-- Child rows follow the parent session's ownership.
drop policy if exists quotes_select_own on public.quotes;
create policy quotes_select_own on public.quotes
  for select using (
    exists (
      select 1 from public.quote_sessions s
      where s.id = quotes.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists provider_requests_select_own on public.provider_requests;
create policy provider_requests_select_own on public.provider_requests
  for select using (
    exists (
      select 1 from public.quote_sessions s
      where s.id = provider_requests.session_id and s.user_id = auth.uid()
    )
  );

-- recent_searches: full owner control, including delete — history deletion is
-- a product requirement, not an afterthought.
drop policy if exists recent_searches_all_own on public.recent_searches;
create policy recent_searches_all_own on public.recent_searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- booking_handoff_events: owner reads only.
drop policy if exists handoff_select_own on public.booking_handoff_events;
create policy handoff_select_own on public.booking_handoff_events
  for select using (auth.uid() is not null and auth.uid() = user_id);

-- Operational tables: NO policies. With RLS enabled and no policy, the anon and
-- authenticated roles can read nothing; only the service role bypasses RLS.
--   source_discrepancies, provider_health_events, api_usage_daily,
--   provider_configuration

-- Belt and braces: revoke direct table privileges from the client roles for the
-- operational tables, so a future permissive policy cannot silently open them.
revoke all on public.source_discrepancies   from anon, authenticated;
revoke all on public.provider_health_events from anon, authenticated;
revoke all on public.api_usage_daily        from anon, authenticated;
revoke all on public.provider_configuration from anon, authenticated;
