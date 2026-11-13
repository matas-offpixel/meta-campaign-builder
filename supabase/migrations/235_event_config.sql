-- Migration 235 — per-event config (dashboard v2, D9 / HD2)
--
-- docs/design-record/2026-11-13-dashboard-v2.html, D9 and HD2.
-- These fields replace the NX model's constants. They are set on the
-- event page, and nothing is inferred from codes or slugs.
--
--   events.is_umbrella      An umbrella (NX26-GLOBAL) has no trajectory, no
--                           tickets and no cost per ticket. Its spend is
--                           shown on its own, never in "All shows".
--   events.cirqlin_page_id  The CIRQLIN page the show's registrations come
--                           from. The page id (pages.id, a uuid), not the
--                           slug and not an event code: CIRQLIN's events
--                           table has no external_event_code column (its
--                           main at #619 has id, org_id, title, event_date),
--                           and a slug changes when a page is renamed. The
--                           check keeps slugs and URLs out. The operator
--                           pastes a link; the server resolves it with
--                           CIRQLIN's GET /api/partner/page and stores the
--                           id. The pasted link is never stored.
--   events.cirqlin_page_title / cirqlin_page_slug / cirqlin_page_checked_at
--                           A cache of the page's title and slug as CIRQLIN
--                           last returned them, and when. Dashboards and share
--                           pages read these and never call CIRQLIN (the
--                           endpoint's rate limit is shared with the signups
--                           cron). Only the edit page refreshes them, by ?id=,
--                           for its one event.
--   event_reference_shows   An event's own reference set for D10. No rows =
--                           the client's library (the default).
--   event_count_aliases     The show name exactly as Internal Counts writes
--                           it (D8). Unique on alias: one sheet name maps to
--                           one event. Case and spacing are kept as written
--                           ("Folamour" and "FOLAMOUR" are two aliases).
--
-- Capacity stays events.capacity. Sellable allocation is a read helper
-- (lib/event-config/allocation.ts): the sum of tier_channel_allocations
-- for paid tiers, else capacity. It is not a column.
--
-- Data: NX26-GLOBAL is flagged umbrella. No aliases are seeded: HD1's
-- review list proposes them and Matas confirms each one.
--
-- RLS: owner-only through the event, the pattern migration 077 uses for
-- event child tables (service role, or an event the user owns). The cron
-- reads with the service role.
--
-- Write only. Not applied from this branch. Ops applies from main.
-- 234 (HD1, Internal Counts, #1217) is the migration this follows.

alter table public.events
  add column if not exists is_umbrella boolean not null default false;

alter table public.events
  add column if not exists cirqlin_page_id text;

alter table public.events
  drop constraint if exists events_cirqlin_page_id_uuid;
alter table public.events
  add constraint events_cirqlin_page_id_uuid check (
    cirqlin_page_id is null
    or cirqlin_page_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

alter table public.events
  add column if not exists cirqlin_page_title text;
alter table public.events
  add column if not exists cirqlin_page_slug text;
alter table public.events
  add column if not exists cirqlin_page_checked_at timestamptz;

comment on column public.events.is_umbrella is
  'D9: an umbrella event (shared marketing across a client''s shows). No trajectory, no tickets, no cost per ticket; its spend is shown separately. Migration 235.';
comment on column public.events.cirqlin_page_id is
  'D9: the CIRQLIN page id (pages.id, lower-case uuid) the show''s registrations come from. Null = "No CIRQLIN page". Migration 235.';
comment on column public.events.cirqlin_page_title is
  'Cache: the CIRQLIN page''s title as GET /api/partner/page last returned it. Refreshed only from the edit page. Migration 235.';
comment on column public.events.cirqlin_page_slug is
  'Cache: the CIRQLIN page''s slug as GET /api/partner/page last returned it (shown as crqln.com/{slug}). Refreshed only from the edit page. Migration 235.';
comment on column public.events.cirqlin_page_checked_at is
  'When CIRQLIN last confirmed the cached title and slug. Migration 235.';


-- ── Reference shows ─────────────────────────────────────────────────────────

create table if not exists public.event_reference_shows (
  event_id            uuid not null references public.events (id) on delete cascade,
  reference_event_id  uuid not null references public.events (id) on delete cascade,
  created_at          timestamptz not null default now(),
  primary key (event_id, reference_event_id),
  constraint event_reference_shows_not_self check (event_id <> reference_event_id)
);

comment on table public.event_reference_shows is
  'D9 / D10: the shows an event compares against. No rows = the client''s reference library. Migration 235.';

create index if not exists event_reference_shows_reference_idx
  on public.event_reference_shows (reference_event_id);

alter table public.event_reference_shows enable row level security;

drop policy if exists event_reference_shows_select on public.event_reference_shows;
create policy event_reference_shows_select on public.event_reference_shows
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists event_reference_shows_insert on public.event_reference_shows;
create policy event_reference_shows_insert on public.event_reference_shows
  for insert with check (
    auth.role() = 'service_role'
    or (
      event_id in (select id from public.events where user_id = auth.uid())
      and reference_event_id in (select id from public.events where user_id = auth.uid())
    )
  );

drop policy if exists event_reference_shows_delete on public.event_reference_shows;
create policy event_reference_shows_delete on public.event_reference_shows
  for delete using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );


-- ── Count aliases ───────────────────────────────────────────────────────────

create table if not exists public.event_count_aliases (
  event_id    uuid not null references public.events (id) on delete cascade,
  alias       text not null,
  created_at  timestamptz not null default now(),
  constraint event_count_aliases_alias_unique unique (alias),
  constraint event_count_aliases_alias_not_blank check (alias <> '')
);

comment on table public.event_count_aliases is
  'D8 / D9: a show name exactly as Internal Counts writes it, and the event it is. Unique on alias: one sheet name maps to one event. Migration 235.';

create index if not exists event_count_aliases_event_idx
  on public.event_count_aliases (event_id);

alter table public.event_count_aliases enable row level security;

drop policy if exists event_count_aliases_select on public.event_count_aliases;
create policy event_count_aliases_select on public.event_count_aliases
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists event_count_aliases_insert on public.event_count_aliases;
create policy event_count_aliases_insert on public.event_count_aliases
  for insert with check (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists event_count_aliases_delete on public.event_count_aliases;
create policy event_count_aliases_delete on public.event_count_aliases
  for delete using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );


-- ── Data ────────────────────────────────────────────────────────────────────

update public.events
set is_umbrella = true
where event_code = 'NX26-GLOBAL';

notify pgrst, 'reload schema';
