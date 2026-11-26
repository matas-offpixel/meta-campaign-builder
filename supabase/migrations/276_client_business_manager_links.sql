-- 276_client_business_manager_links.sql
--
-- One Business Manager linked to several clients (Matas, 27 Nov: "LWE
-- Business Manager links to both Junction 2 and Ironworks (the LWE ad
-- account): allow one Business Manager linked to several clients").
--
-- client_business_managers holds one row per business (business_id is
-- UNIQUE; bm_pages and the other BM tables reference it, and the row holds
-- that BM's encrypted token), with a single client_id. So a second client
-- can't be a second row. This adds a link table: one row per (business,
-- client). client_business_managers.client_id stays as it is, the BM's
-- primary client, which the BM tool, its scan cron and the launch checks
-- already read; readers that need every client read both
-- (lib/bm/client-links.ts).
--
-- Additive only: a new table, its RLS (authenticated read, service-role
-- write, as 145's BM tables), and a backfill of today's client_id links.
-- Written by scripts/link-client-business-managers.mts --apply only.

create table if not exists public.client_business_manager_links (
  id          uuid        primary key default gen_random_uuid(),
  business_id text        not null references public.client_business_managers (business_id) on delete cascade,
  client_id   uuid        not null references public.clients (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (business_id, client_id)
);

comment on table public.client_business_manager_links is
  'Which clients a connected Business Manager belongs to (276): one row per business and client, so one BM can serve several clients. client_business_managers.client_id stays the primary client. Written by scripts/link-client-business-managers.mts --apply.';

create index if not exists client_business_manager_links_client_idx
  on public.client_business_manager_links (client_id);

alter table public.client_business_manager_links enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_business_manager_links'
      and policyname = 'authenticated read business manager links'
  ) then
    execute
      'create policy "authenticated read business manager links" '
      'on public.client_business_manager_links for select to authenticated using (true)';
  end if;
end $$;

-- Today's links (client_business_managers.client_id) as link rows.
insert into public.client_business_manager_links (business_id, client_id)
select business_id, client_id
from public.client_business_managers
where client_id is not null
on conflict (business_id, client_id) do nothing;
