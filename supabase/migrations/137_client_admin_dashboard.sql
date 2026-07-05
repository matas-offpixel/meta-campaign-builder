-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 137 — client admin dashboard (OP909 self-service, Phase 1 of the
-- admin-dashboard arc; see docs/ADMIN_DASHBOARD_ARCHITECTURE.md).
--
-- ONE migration covers ALL admin-arc schema changes (phases 1–10) so the
-- ledger stays clean while the phases ship as sequential PRs. Follow-up
-- schema needs go in 138+, never edits to this file post-apply.
--
-- 1. client_users — maps a Supabase auth user to exactly ONE client
--    (single-user-per-client MVP; role enum extensible later). This is the
--    authorisation pivot for the whole /admin surface: middleware +
--    requireClientContext() resolve membership through it, and the new RLS
--    policies below grant client members READ access to their own client's
--    landing-page data. Writes stay service-role-only (server actions
--    validate + stamp fields app-side after requireClientContext()).
-- 2. client_landing_pages — brand_instagram_url_default /
--    brand_tiktok_url_default (Phase 2 org settings; the admin editor
--    prefills per-page content overrides from these — the fan renderer
--    keeps reading ONLY page_events.content, no renderer change).
-- 3. event_signups.deleted_at — Phase 5 soft-delete for the fan table
--    (rows are never hard-deleted from the admin UI; exports + analytics
--    filter `deleted_at is null`).
-- 4. Storage bucket `landing-page-assets` — Phase 3 artwork/hero/bottom
--    image uploads, public read (LP images are public by definition),
--    service-role write only, client_id-scoped path prefixes enforced
--    app-side ({client_id}/{page_event_id}/...).
-- 5. Client-member READ RLS on clients / events / page_events /
--    client_landing_pages / event_signups via the client_users chain.
--    These are ADDITIVE permissive SELECT policies alongside the existing
--    operator (`user_id = auth.uid()`) policies.
-- 6. Seed: matt.liebus@gmail.com → GMC Worldwide Productions
--    (2f0dbe34-35ce-4df3-a655-32faa6a0f710). Warns + skips if the auth
--    user does not exist at apply time.
--
-- Reversibility:
--   drop table if exists client_users;
--   alter table client_landing_pages
--     drop column if exists brand_instagram_url_default,
--     drop column if exists brand_tiktok_url_default;
--   alter table event_signups drop column if exists deleted_at;
--   delete from storage.buckets where id = 'landing-page-assets';
--   drop policy if exists "client member reads own client" on clients;
--   drop policy if exists "client member reads client events" on events;
--   drop policy if exists "client member reads client page events" on page_events;
--   drop policy if exists "client member reads client landing page" on client_landing_pages;
--   drop policy if exists "client member reads client signups" on event_signups;
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: every statement is `if not exists` / `on conflict` or
-- catalog-checked.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. client_users ──────────────────────────────────────────────────────────

create table if not exists client_users (
  id         uuid        primary key default gen_random_uuid(),
  -- UNIQUE: one client per auth user (MVP). A future multi-client operator
  -- persona would relax this to unique (user_id, client_id).
  user_id    uuid        not null unique references auth.users (id) on delete cascade,
  client_id  uuid        not null references clients (id) on delete cascade,
  role       text        not null default 'owner',
  created_at timestamptz not null default now(),

  constraint client_users_role_check check (role in ('owner'))
);

comment on table client_users is
  'Maps a Supabase auth user to the ONE client whose /admin dashboard they may access (OP909 self-service). Authorisation pivot for the /admin surface: middleware + requireClientContext() + the client-member RLS policies all resolve through this table. Rows are managed via SQL / service-role only (no self-signup). Migration 137.';

comment on column client_users.role is
  'Only ''owner'' for the MVP — the CHECK stays a named constraint so future roles (''editor'', ''viewer'') are one ALTER away.';

create index if not exists client_users_client_id_idx
  on client_users (client_id);

alter table client_users enable row level security;

-- Self-read only: a member can see their OWN membership row (the proxy +
-- requireClientContext() resolve the slug through this with the session
-- client). No INSERT/UPDATE/DELETE policies — provisioning is operator SQL.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'client_users'
      and policyname = 'member reads own membership'
  ) then
    execute
      'create policy "member reads own membership" '
      'on client_users for select '
      'using (user_id = auth.uid())';
  end if;
end $$;

-- ── 2. client_landing_pages — Phase 2 brand-social defaults ─────────────────

alter table client_landing_pages
  add column if not exists brand_instagram_url_default text;
alter table client_landing_pages
  add column if not exists brand_tiktok_url_default text;

comment on column client_landing_pages.brand_instagram_url_default is
  'Client-level default for the LP brand-socials row. The ADMIN editor prefills page_events.content.brand_instagram_url from this — the fan renderer keeps reading only content (no renderer fallback). Migration 137.';
comment on column client_landing_pages.brand_tiktok_url_default is
  'TikTok twin of brand_instagram_url_default. Migration 137.';

-- ── 3. event_signups — Phase 5 soft delete ──────────────────────────────────

alter table event_signups
  add column if not exists deleted_at timestamptz;

comment on column event_signups.deleted_at is
  'Soft-delete stamp set from the admin fan table. Non-null rows are hidden from the admin UI, CSV exports, and analytics aggregates; the row (and its dedupe hashes) stays so a re-signup still dedupes. Migration 137.';

-- ── 4. Storage bucket for LP asset uploads (Phase 3) ────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'landing-page-assets',
  'landing-page-assets',
  true,
  10485760,  -- 10 MB per image
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Public read (LP artwork/hero/bottom images are public on /l by
-- definition). Writes are service-role only — the upload server action
-- enforces the {client_id}/{page_event_id}/ path prefix app-side after
-- requireClientContext().
drop policy if exists "Public read landing page assets" on storage.objects;
create policy "Public read landing page assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'landing-page-assets');

-- ── 5. Client-member READ RLS via the client_users chain ────────────────────
-- Additive permissive SELECT policies alongside the operator policies.
-- Writes from the admin surface go through service-role server actions
-- (validated + client-scoped app-side), so no write policies here.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clients'
      and policyname = 'client member reads own client'
  ) then
    execute
      'create policy "client member reads own client" '
      'on clients for select '
      'using (exists (select 1 from client_users cu '
      'where cu.client_id = clients.id and cu.user_id = auth.uid()))';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'events'
      and policyname = 'client member reads client events'
  ) then
    execute
      'create policy "client member reads client events" '
      'on events for select '
      'using (exists (select 1 from client_users cu '
      'where cu.client_id = events.client_id and cu.user_id = auth.uid()))';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'page_events'
      and policyname = 'client member reads client page events'
  ) then
    execute
      'create policy "client member reads client page events" '
      'on page_events for select '
      'using (exists (select 1 from events e '
      'join client_users cu on cu.client_id = e.client_id '
      'where e.id = page_events.event_id and cu.user_id = auth.uid()))';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_landing_pages'
      and policyname = 'client member reads client landing page'
  ) then
    execute
      'create policy "client member reads client landing page" '
      'on client_landing_pages for select '
      'using (exists (select 1 from client_users cu '
      'where cu.client_id = client_landing_pages.client_id '
      'and cu.user_id = auth.uid()))';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'event_signups'
      and policyname = 'client member reads client signups'
  ) then
    execute
      'create policy "client member reads client signups" '
      'on event_signups for select '
      'using (exists (select 1 from client_users cu '
      'where cu.client_id = event_signups.client_id '
      'and cu.user_id = auth.uid()))';
  end if;
end $$;

-- ── 6. Seed: matt.liebus@gmail.com → GMC Worldwide Productions ──────────────

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where email = 'matt.liebus@gmail.com'
  limit 1;

  if v_user_id is null then
    raise warning 'migration 137 seed: auth user matt.liebus@gmail.com not found — skipping client_users seed (add manually later)';
  else
    insert into client_users (user_id, client_id, role)
    values (v_user_id, '2f0dbe34-35ce-4df3-a655-32faa6a0f710', 'owner')
    on conflict (user_id) do nothing;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification block — raises inside the migration transaction on any miss,
-- so a partial apply is loud and rolls back (PR-1 pattern).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_count int;
begin
  -- client_users exists with the expected columns.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'client_users'
    and column_name in ('id', 'user_id', 'client_id', 'role', 'created_at');
  if v_count <> 5 then
    raise exception 'migration 137 verification: expected 5 client_users columns, found %', v_count;
  end if;

  -- RLS is enabled on client_users.
  select count(*) into v_count
  from pg_class
  where relname = 'client_users' and relrowsecurity;
  if v_count <> 1 then
    raise exception 'migration 137 verification: RLS not enabled on client_users';
  end if;

  -- The self-read policy exists.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'client_users'
    and policyname = 'member reads own membership';
  if v_count <> 1 then
    raise exception 'migration 137 verification: client_users self-read policy missing';
  end if;

  -- The five client-member read policies exist.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'client member reads own client',
      'client member reads client events',
      'client member reads client page events',
      'client member reads client landing page',
      'client member reads client signups'
    );
  if v_count <> 5 then
    raise exception 'migration 137 verification: expected 5 client-member read policies, found %', v_count;
  end if;

  -- Phase 2 columns present.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'client_landing_pages'
    and column_name in ('brand_instagram_url_default', 'brand_tiktok_url_default');
  if v_count <> 2 then
    raise exception 'migration 137 verification: expected 2 brand-social default columns, found %', v_count;
  end if;

  -- Phase 5 soft-delete column present.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'event_signups'
    and column_name = 'deleted_at';
  if v_count <> 1 then
    raise exception 'migration 137 verification: event_signups.deleted_at missing';
  end if;

  -- Storage bucket present.
  select count(*) into v_count
  from storage.buckets
  where id = 'landing-page-assets';
  if v_count <> 1 then
    raise exception 'migration 137 verification: landing-page-assets bucket missing';
  end if;

  raise notice 'migration 137 verification: all assertions passed';
end $$;

notify pgrst, 'reload schema';
