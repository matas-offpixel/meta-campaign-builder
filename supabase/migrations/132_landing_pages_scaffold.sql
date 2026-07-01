-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 132 — landing pages scaffold (PR 1 of the landing-page arc)
--
-- (Claimed 132: repo files top out at 130; the prod ledger consumed 131 as
--  `131_enable_pgcrypto_for_d2c_credentials`, applied directly via MCP on
--  2026-07-01 with no repo file. See MIGRATIONS_NOTES.md.)
--
-- Three tables backing the internal client-branded landing pages that will
-- replace Evntr.ee (trial client: GMC Worldwide Productions):
--
--   client_landing_pages — one row per client: theme + the client's OWN Meta
--                          Pixel ID + CAPI token (encrypted). Per-client
--                          credential silo, baked in from day 1 (C+O
--                          non-negotiable C).
--   page_events          — one row per event: provider toggle
--                          ('internal' | 'evntree') for dual-run rollback
--                          (C+O non-negotiable D), theme overrides, content.
--   page_templates       — workspace-global template registry. Seeded with
--                          'mvp_v1'.
--
-- ENCRYPTION LANDMINE (learned 2026-07-01): pgcrypto lives in the
-- `extensions` schema, NOT `public`. Any function touching
-- pgp_sym_encrypt/decrypt MUST either schema-qualify the call
-- (`extensions.pgp_sym_encrypt`) or include 'extensions' in its search_path.
-- The prod `set/get_d2c_credentials` functions from migration 042 still call
-- the unqualified names under `search_path = public` and are broken as of
-- this writing — do not copy that shape. This migration's verification block
-- probes `extensions.pgp_sym_encrypt` so a misconfigured environment fails
-- loudly at apply time, before PR 4 wires the CAPI token accessors.
--
-- RLS posture (mirrors migration 123 `client_portal_snapshots`):
--   * No denormalised user_id columns — ownership resolves through the
--     `clients.user_id` / `events.user_id` chain via EXISTS policies.
--   * Owner sessions get full CRUD on client_landing_pages / page_events for
--     rows whose parent client/event they own.
--   * page_templates: RLS ENABLED with authenticated-read only. The spec said
--     "no RLS (workspace-global)", but a no-RLS table in `public` is readable
--     AND writable by the anon PostgREST role under Supabase default grants.
--     Same workspace-global semantics, without the anon write hole. Writes
--     are service-role only (no write policies).
--   * The public /l/[clientSlug]/[eventSlug] route reads via the service-role
--     client (bypasses RLS) — see docs/LANDING_PAGE_ARCHITECTURE.md.
--
-- Reversibility:
--   drop table if exists page_events;
--   drop table if exists client_landing_pages;
--   drop table if exists page_templates;
-- (No existing tables/columns are touched.)
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: every statement is `if not exists` or catalog-checked.
-- ─────────────────────────────────────────────────────────────────────────────

-- Shared updated_at trigger function — defined idempotently (003/042 pattern)
-- so this migration is self-contained.
create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- client_landing_pages
-- One row per client. Owns everything that is CLIENT-level: theme, the
-- client's own Meta Pixel ID + CAPI token, and the default provider for new
-- page_events rows.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists client_landing_pages (
  id                        uuid        primary key default gen_random_uuid(),
  client_id                 uuid        not null unique
                              references clients (id) on delete cascade,
  -- Theme schema is TBD in PR 2 (fonts / palette / logo url). Empty object
  -- until then; renderers must treat missing keys as "use globals".
  theme                     jsonb       not null default '{}'::jsonb,
  -- The CLIENT's own Meta Pixel ID. See column comment below — never
  -- Off/Pixel's, never another client's.
  meta_pixel_id             text,
  -- pgcrypto blob: extensions.pgp_sym_encrypt(token, key). Accessor RPCs are
  -- PR 4's job — this PR only reserves the column so the credential silo is
  -- schema-level from day 1 (no retrofit).
  meta_capi_token_encrypted bytea,
  -- Default provider stamped onto NEW page_events rows for this client.
  -- 'evntree' default = safe rollback posture while GMC dual-runs.
  default_provider          text        not null default 'evntree',
  created_by                uuid        references auth.users (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint client_landing_pages_default_provider_check check (
    default_provider in ('internal', 'evntree')
  )
);

comment on table client_landing_pages is
  'Per-client landing-page config: theme + the client''s OWN Meta Pixel + CAPI token (encrypted). One row per client. Migration 132 (PR 1 of the landing-page arc).';

comment on column client_landing_pages.meta_pixel_id is
  'The CLIENT''s own Meta Pixel ID. Landing-page events (client-side and CAPI) fire to THIS pixel with THIS client''s token — never to Off/Pixel''s own pixel and never to another client''s. Cross-contamination between clients is a PRIVACY BUG: it leaks one client''s audience into another''s (or Off/Pixel''s) retargeting pool. NOTE: distinct from clients.meta_pixel_id, which is the pixel Off/Pixel operates ad campaigns against — the two may coincide for some clients but are separate concerns; never fall back from one to the other.';

comment on column client_landing_pages.meta_capi_token_encrypted is
  'extensions.pgp_sym_encrypt(capi_token, key) — pgcrypto lives in the `extensions` schema; any accessor function MUST schema-qualify or set search_path to include extensions (see migration 042''s search_path=public bug). Accessor RPCs land in PR 4.';

comment on column client_landing_pages.default_provider is
  'Provider stamped onto new page_events rows for this client. ''evntree'' until the client''s first 2 events pass live validation on the internal renderer.';

create trigger client_landing_pages_updated_at
  before update on client_landing_pages
  for each row execute procedure update_updated_at_column();

alter table client_landing_pages enable row level security;

-- Owner CRUD via the clients.user_id chain (no denormalised user_id — the
-- 123 client_portal_snapshots pattern). Service-role bypasses RLS for the
-- public /l read path.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'client_landing_pages'
      and policyname = 'owner manage client landing pages'
  ) then
    execute
      'create policy "owner manage client landing pages" '
      'on client_landing_pages for all '
      'using (exists (select 1 from clients c '
      'where c.id = client_landing_pages.client_id '
      'and c.user_id = auth.uid())) '
      'with check (exists (select 1 from clients c '
      'where c.id = client_landing_pages.client_id '
      'and c.user_id = auth.uid()))';
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- page_events
-- One row per event. Owns everything that is EVENT-level: the provider
-- toggle (rollback lever), evntree fallback URL, per-event theme overrides,
-- and page content.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists page_events (
  id              uuid        primary key default gen_random_uuid(),
  event_id        uuid        not null unique
                    references events (id) on delete cascade,
  provider        text        not null default 'evntree',
  -- Required when provider='evntree' (enforced by CHECK below). The public
  -- route 302s here instead of rendering internally.
  evntree_url     text,
  theme_overrides jsonb       not null default '{}'::jsonb,
  -- Free-form page content for the MVP renderer. Carries `template_key`
  -- (which page_templates row renders this page) until PR 2 promotes the
  -- binding to a real FK column.
  content         jsonb       not null default '{}'::jsonb,
  status          text        not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint page_events_provider_check check (
    provider in ('internal', 'evntree')
  ),
  constraint page_events_status_check check (
    status in ('draft', 'live', 'archived')
  ),
  -- Loud-fail, not silent bad state: an evntree page with nowhere to
  -- redirect is a misconfiguration and must be impossible to persist.
  constraint page_events_evntree_url_required check (
    provider <> 'evntree' or evntree_url is not null
  )
);

comment on table page_events is
  'Per-event landing-page row. `provider` is the rollback lever: ''evntree'' → public route 302s to evntree_url; ''internal'' → internal renderer. One row per event. Migration 132.';

comment on column page_events.provider is
  'Per-event provider toggle (C+O non-negotiable D). Flip back to ''evntree'' at any time to roll off the internal renderer — Evntr.ee stays live during GMC''s first 2 events as redundancy.';

create trigger page_events_updated_at
  before update on page_events
  for each row execute procedure update_updated_at_column();

alter table page_events enable row level security;

-- Ownership chain: page_events → events → (auth.uid() = events.user_id).
-- events.user_id and clients.user_id are always the same operator today;
-- events is the direct parent so it is the policy pivot.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'page_events'
      and policyname = 'owner manage page events'
  ) then
    execute
      'create policy "owner manage page events" '
      'on page_events for all '
      'using (exists (select 1 from events e '
      'where e.id = page_events.event_id '
      'and e.user_id = auth.uid())) '
      'with check (exists (select 1 from events e '
      'where e.id = page_events.event_id '
      'and e.user_id = auth.uid()))';
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- page_templates
-- Workspace-global template registry. Not client-scoped.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists page_templates (
  id                    uuid    primary key default gen_random_uuid(),
  key                   text    unique not null,
  name                  text    not null,
  block_types_supported jsonb   not null default '[]'::jsonb,
  default_config        jsonb   not null default '{}'::jsonb,
  version               int     not null default 1
);

comment on table page_templates is
  'Workspace-global landing-page template registry. RLS: authenticated read, service-role write (a no-RLS table in public would be anon-writable under Supabase default grants). Migration 132.';

alter table page_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'page_templates'
      and policyname = 'authenticated read page templates'
  ) then
    execute
      'create policy "authenticated read page templates" '
      'on page_templates for select '
      'to authenticated '
      'using (true)';
  end if;
end $$;

-- Seed the MVP template. Idempotent — re-applies are no-ops.
insert into page_templates (key, name, block_types_supported, default_config)
values (
  'mvp_v1',
  'MVP v1',
  '["hero", "event_card", "signup_form", "footer"]'::jsonb,
  '{}'::jsonb
)
on conflict (key) do nothing;


-- ─────────────────────────────────────────────────────────────────────────────
-- Verification block — SELECT-based assertions that the DDL above actually
-- produced the expected policies, CHECK constraints, and seed row. A raise
-- here aborts the migration transaction, so a partial/failed apply is loud
-- and rolls back rather than leaving silent bad state.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_count int;
begin
  -- RLS enabled on all three tables.
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('client_landing_pages', 'page_events', 'page_templates')
    and c.relrowsecurity;
  if v_count <> 3 then
    raise exception 'migration 132 verification: expected RLS enabled on 3 tables, found %', v_count;
  end if;

  -- Policies exist.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and (
      (tablename = 'client_landing_pages' and policyname = 'owner manage client landing pages')
      or (tablename = 'page_events' and policyname = 'owner manage page events')
      or (tablename = 'page_templates' and policyname = 'authenticated read page templates')
    );
  if v_count <> 3 then
    raise exception 'migration 132 verification: expected 3 RLS policies, found %', v_count;
  end if;

  -- page_templates must have NO write policies (service-role only).
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'page_templates'
    and cmd <> 'SELECT';
  if v_count <> 0 then
    raise exception 'migration 132 verification: page_templates must have no write policies, found %', v_count;
  end if;

  -- CHECK constraints exist.
  select count(*) into v_count
  from pg_constraint
  where contype = 'c'
    and conname in (
      'client_landing_pages_default_provider_check',
      'page_events_provider_check',
      'page_events_status_check',
      'page_events_evntree_url_required'
    );
  if v_count <> 4 then
    raise exception 'migration 132 verification: expected 4 CHECK constraints, found %', v_count;
  end if;

  -- Unique constraints on the tenancy pivots (one landing page per client,
  -- one page row per event, unique template keys).
  select count(*) into v_count
  from pg_constraint
  where contype = 'u'
    and conrelid in (
      'public.client_landing_pages'::regclass,
      'public.page_events'::regclass,
      'public.page_templates'::regclass
    );
  if v_count < 3 then
    raise exception 'migration 132 verification: expected >= 3 unique constraints across the new tables, found %', v_count;
  end if;

  -- Seed row present.
  select count(*) into v_count from page_templates where key = 'mvp_v1';
  if v_count <> 1 then
    raise exception 'migration 132 verification: page_templates seed row mvp_v1 missing';
  end if;

  -- pgcrypto reachable where PR 4's CAPI accessors will need it. Loud apply-
  -- time failure beats a runtime undefined_function (the migration 042/131
  -- lesson).
  perform extensions.pgp_sym_encrypt('probe', 'migration-132-probe-key');

  raise notice 'migration 132 verification: all assertions passed';
end $$;

-- Refresh PostgREST schema cache so new tables are exposed to the API.
notify pgrst, 'reload schema';
