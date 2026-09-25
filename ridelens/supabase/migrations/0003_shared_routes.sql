-- Shareable comparison links.
--
-- This is the ONE place a route is stored so it can be retrieved by an opaque
-- id, and it exists only because the rider explicitly pressed Share. Rows
-- expire (see SHARE_TTL_DAYS) so shared location history does not accrete.
--
-- No price is ever stored here: opening a share re-runs the comparison live.

create table if not exists public.shared_routes (
  id            text primary key,
  pickup        jsonb not null,
  destination   jsonb not null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  open_count    integer not null default 0
);

create index if not exists shared_routes_expires_idx on public.shared_routes (expires_at);

alter table public.shared_routes enable row level security;

-- No client policies: creation and resolution both go through server routes
-- holding the service key. A share id is a capability, and handing the anon
-- role blanket SELECT would make the table enumerable.
revoke all on public.shared_routes from anon, authenticated;

-- Housekeeping for expired shares. Schedule with pg_cron, or call from a job.
create or replace function public.purge_expired_shared_routes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.shared_routes where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Open counter, called best-effort by the resolver.
create or replace function public.increment_share_open(share_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shared_routes set open_count = open_count + 1 where id = share_id;
$$;
