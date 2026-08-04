-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 150 — WhatsApp community alias redirects
--
-- Backs /j/{slug} indirection for Bird/Meta WhatsApp template buttons.
-- Templates keep a static approved-domain URL (app.offpixel.co.uk/j/…).
-- Operators can repoint a slug's destination invite code without a new
-- Meta template review when a community group fills up.
--
-- Tables:
--   1. wa_community_aliases              — slug → brand/client, active flag
--   2. wa_community_alias_destinations   — ordered invite codes per alias;
--                                          exactly one may be active
--   3. wa_community_alias_events         — append-only audit (create / repoint / …)
--
-- Public route looks up by slug via service-role; raw invite codes that do
-- not match an alias still pass through unchanged (legacy templates).
--
-- RLS: authenticated read (invite-only app = operators). No write policies —
-- writes go through service-role after requireOperator() in API routes.
-- Same shape as migration 145 (Business Manager Asset Sync).
--
-- Reversibility:
--   drop table if exists wa_community_alias_events;
--   drop table if exists wa_community_alias_destinations;
--   drop table if exists wa_community_aliases;
--
-- Apply BEFORE merge via the Supabase MCP `apply_migration`.
-- /j/* is on the live critical path of already-approved WhatsApp templates:
-- additive schema that new code reads must exist first. Idempotent:
-- `if not exists` + catalog-checked DO blocks throughout.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── wa_community_aliases ─────────────────────────────────────────────────────

create table if not exists wa_community_aliases (
  id                   uuid        primary key default gen_random_uuid(),
  -- URL path segment under /j/{slug}. Lowercase alphanumeric + hyphens only.
  slug                 text        not null,
  -- Optional CRM client association. Nullable so an alias can be brand-only.
  client_id            uuid        references clients (id) on delete set null,
  -- Freeform brand label shown in the ops UI (e.g. "Throwback", "Jackies").
  brand                text,
  is_active            boolean     not null default true,
  notes                text,
  -- Denormalised copy of the active destination invite code for fast public
  -- lookup. Kept in sync by lib/db/wa-community-aliases.ts on every activate.
  active_invite_code   text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by_user_id   uuid        references auth.users (id) on delete set null,
  updated_by_user_id   uuid        references auth.users (id) on delete set null,
  constraint wa_community_aliases_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint wa_community_aliases_slug_unique unique (slug)
);

comment on table wa_community_aliases is
  'Vanity slugs for /j/{slug} WhatsApp community redirects. Destination invite codes live in wa_community_alias_destinations; active_invite_code is denormalised for the public route. Migration 150.';
comment on column wa_community_aliases.slug is
  'Lowercase alphanumeric + hyphens. Appears in template buttons as app.offpixel.co.uk/j/{slug}.';
comment on column wa_community_aliases.active_invite_code is
  'Current WhatsApp invite path segment. Null only before the first destination is activated.';

create index if not exists idx_wa_community_aliases_client
  on wa_community_aliases (client_id);
create index if not exists idx_wa_community_aliases_active
  on wa_community_aliases (slug) where is_active = true;

-- ── wa_community_alias_destinations ──────────────────────────────────────────

create table if not exists wa_community_alias_destinations (
  id           uuid        primary key default gen_random_uuid(),
  alias_id     uuid        not null references wa_community_aliases (id) on delete cascade,
  invite_code  text        not null,
  -- Operator-facing label, e.g. "Group 1", "Overflow".
  label        text,
  sort_order   integer     not null default 0,
  is_active    boolean     not null default false,
  activated_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint wa_community_alias_destinations_invite_format
    check (invite_code ~ '^[A-Za-z0-9]{8,30}$'),
  constraint wa_community_alias_destinations_alias_invite_unique
    unique (alias_id, invite_code)
);

comment on table wa_community_alias_destinations is
  'Ordered WhatsApp invite codes staged under an alias. At most one is_active per alias (partial unique index). Migration 150.';

create index if not exists idx_wa_community_alias_destinations_alias
  on wa_community_alias_destinations (alias_id, sort_order);

-- Exactly one active destination per alias (when any is active).
create unique index if not exists uq_wa_community_alias_destinations_one_active
  on wa_community_alias_destinations (alias_id)
  where is_active = true;

-- ── wa_community_alias_events ────────────────────────────────────────────────

create table if not exists wa_community_alias_events (
  id       uuid        primary key default gen_random_uuid(),
  alias_id uuid        not null references wa_community_aliases (id) on delete cascade,
  user_id  uuid        references auth.users (id) on delete set null,
  action   text        not null
             check (action in (
               'created',
               'updated',
               'repointed',
               'destination_added',
               'destination_removed',
               'activated',
               'deactivated'
             )),
  detail   jsonb       not null default '{}'::jsonb,
  at       timestamptz not null default now()
);

comment on table wa_community_alias_events is
  'Append-only audit of WA community alias changes (create / repoint / activate / …). Migration 150.';

create index if not exists idx_wa_community_alias_events_alias_at
  on wa_community_alias_events (alias_id, at desc);
create index if not exists idx_wa_community_alias_events_recent
  on wa_community_alias_events (at desc);

-- ── updated_at trigger ───────────────────────────────────────────────────────

create or replace function set_wa_community_aliases_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists wa_community_aliases_set_updated_at on wa_community_aliases;
create trigger wa_community_aliases_set_updated_at
  before update on wa_community_aliases
  for each row execute function set_wa_community_aliases_updated_at();

-- ── RLS — authenticated read, service-role write ─────────────────────────────

alter table wa_community_aliases            enable row level security;
alter table wa_community_alias_destinations enable row level security;
alter table wa_community_alias_events       enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wa_community_aliases'
      and policyname = 'authenticated read wa community aliases'
  ) then
    execute
      'create policy "authenticated read wa community aliases" '
      'on wa_community_aliases for select to authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wa_community_alias_destinations'
      and policyname = 'authenticated read wa community alias destinations'
  ) then
    execute
      'create policy "authenticated read wa community alias destinations" '
      'on wa_community_alias_destinations for select to authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wa_community_alias_events'
      and policyname = 'authenticated read wa community alias events'
  ) then
    execute
      'create policy "authenticated read wa community alias events" '
      'on wa_community_alias_events for select to authenticated using (true)';
  end if;
end $$;

notify pgrst, 'reload schema';
