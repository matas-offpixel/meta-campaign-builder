-- Migration 249 — the presale log (dashboard v2 phase 2, HE4)
--
-- docs/design-record/2026-11-13-dashboard-v2-phase-2.html E2 (community
-- members), E3 (the presale engine) and EV2; amended by
-- 2026-11-15-dashboard-v2-panels-and-he2-gaps.html PB4 (the hand-entered
-- member count lives here, not on HE2's page-audience row).
--
-- Only the entered half of E3 is stored. Everything counted or derived
-- (signups at presale, presale-day tickets from Internal Counts, the
-- conversions, signup spend per presale ticket, presale return) is worked
-- out at read time by lib/dashboard/presale/read.ts.
--
--   presale_logs               One row per show. Each entered figure has its
--                              own entered_by and entered_at, so the panel
--                              can print "entered by {name}, {date}" per
--                              figure. A cleared figure clears its pair.
--     window_start_at          The community window's start. Null = the
--                              default, events.presale_at − 30 min (E3: the
--                              link drop is pasted by hand, so it has no
--                              Bird timestamp).
--     sold_in_window           Tickets sold in the community window. Entered:
--                              snapshot counts can't split a 30-minute
--                              window.
--     avg_ticket_price         The average ticket price, in the show's
--                              ticket currency, for presale return (est.).
--     presale_day_tickets      Presale-day tickets, read only when no
--                              Internal Counts count lands within 24 h after
--                              presale open (E3's 24-hour rule).
--   presale_relaunches         Second presales and relaunches: the date,
--                              "what we did", and the result. The result is
--                              usually written later, so it has its own
--                              entered_by / entered_at. Signups since the
--                              date are counted from CIRQLIN at read time.
--   community_member_counts    Hand-entered WhatsApp community member counts
--                              (E2: communities have no API). One per show
--                              per counted_on day; re-entering a day
--                              replaces it, with the new person and time.
--
-- entered_by is the signed-in user the server action read from the
-- session, never a value the caller sends.
--
-- RLS: the 245 pattern. Owners read their own events' rows (or the service
-- role); there is no insert, update or delete policy, so every write goes
-- through the session-checked server actions in lib/actions/presale-log.ts,
-- which confirm the event is the caller's and then write with the service
-- role.
--
-- Not applied from this branch. Ops applies it from main.
-- 248 (#1250, HE3 attribution) is the migration this follows.

-- ── presale_logs ─────────────────────────────────────────────────────────

create table if not exists public.presale_logs (
  event_id                        uuid primary key references public.events (id) on delete cascade,
  window_start_at                 timestamptz,
  window_start_entered_by         uuid references auth.users (id) on delete set null,
  window_start_entered_at         timestamptz,
  sold_in_window                  integer check (sold_in_window is null or sold_in_window >= 0),
  sold_in_window_entered_by       uuid references auth.users (id) on delete set null,
  sold_in_window_entered_at       timestamptz,
  avg_ticket_price                numeric(10, 2) check (avg_ticket_price is null or avg_ticket_price > 0),
  avg_ticket_price_entered_by     uuid references auth.users (id) on delete set null,
  avg_ticket_price_entered_at     timestamptz,
  presale_day_tickets             integer check (presale_day_tickets is null or presale_day_tickets >= 0),
  presale_day_tickets_entered_by  uuid references auth.users (id) on delete set null,
  presale_day_tickets_entered_at  timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  -- A figure and its "entered" pair are set and cleared together.
  check ((window_start_at is null) = (window_start_entered_at is null)),
  check ((sold_in_window is null) = (sold_in_window_entered_at is null)),
  check ((avg_ticket_price is null) = (avg_ticket_price_entered_at is null)),
  check ((presale_day_tickets is null) = (presale_day_tickets_entered_at is null))
);

comment on table public.presale_logs is
  'HE4 presale log (dashboard v2 phase 2, E3): the entered figures for one show''s presale, each with who entered it and when. Counted and derived figures are read, not stored. Migration 249.';
comment on column public.presale_logs.window_start_at is
  'The community window''s start. Null = events.presale_at − 30 min (E3). Entered because the link drop has no Bird timestamp.';
comment on column public.presale_logs.sold_in_window is
  'Tickets sold in the community window (E3: entered; snapshot counts can''t split a 30-minute window).';
comment on column public.presale_logs.avg_ticket_price is
  'Average ticket price in the show''s ticket currency, for presale return (est.).';
comment on column public.presale_logs.presale_day_tickets is
  'Presale-day tickets, entered. Read only when no Internal Counts count lands within 24 h after presale open (E3).';

-- ── presale_relaunches ───────────────────────────────────────────────────

create table if not exists public.presale_relaunches (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events (id) on delete cascade,
  relaunched_on       date not null,
  what_we_did         text not null check (btrim(what_we_did) <> ''),
  entered_by          uuid references auth.users (id) on delete set null,
  entered_at          timestamptz not null default now(),
  result              text check (result is null or btrim(result) <> ''),
  result_entered_by   uuid references auth.users (id) on delete set null,
  result_entered_at   timestamptz,
  check ((result is null) = (result_entered_at is null))
);

comment on table public.presale_relaunches is
  'HE4: a show''s second presales and relaunches (E3). Date and "what we did" entered; signups since the date counted from CIRQLIN at read time; result entered, usually later. Migration 249.';

create index if not exists presale_relaunches_event_day
  on public.presale_relaunches (event_id, relaunched_on);

-- ── community_member_counts ──────────────────────────────────────────────

create table if not exists public.community_member_counts (
  event_id    uuid not null references public.events (id) on delete cascade,
  counted_on  date not null,
  members     integer not null check (members >= 0),
  entered_by  uuid references auth.users (id) on delete set null,
  entered_at  timestamptz not null default now(),
  primary key (event_id, counted_on)
);

comment on table public.community_member_counts is
  'HE4: hand-entered WhatsApp community member counts per show (E2; PB4 moves the entered count here from HE2). The community tile''s headline when present: "{n} members · entered {date}". Migration 249.';
comment on column public.community_member_counts.counted_on is
  'The day the members were counted (the day the operator read the community), not the day it was typed in (entered_at).';

-- ── RLS: owners read, service role writes ────────────────────────────────

alter table public.presale_logs enable row level security;
alter table public.presale_relaunches enable row level security;
alter table public.community_member_counts enable row level security;

drop policy if exists presale_logs_select_own on public.presale_logs;
create policy presale_logs_select_own on public.presale_logs
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists presale_relaunches_select_own on public.presale_relaunches;
create policy presale_relaunches_select_own on public.presale_relaunches
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists community_member_counts_select_own on public.community_member_counts;
create policy community_member_counts_select_own on public.community_member_counts
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

-- No insert, update or delete policy: service role only, through
-- lib/actions/presale-log.ts after its session and ownership check.

notify pgrst, 'reload schema';
