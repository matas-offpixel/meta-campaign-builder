-- 274_show_spend_ceilings.sql — per-show spend ceilings (MCP, PR D).
--
-- Matas, 26 Nov: "the ceiling is the campaign budget". The connector's spend
-- guard moves from a client's money a day (client_spend_ceilings, 268) to a
-- total per show. A change through the connector that starts or raises spend
-- is refused when the show's committed spend would pass its ceiling:
-- spent to date (ad_daily_insights) + what is left on its live lifetime
-- budgets + its live daily budgets × the days to their end (or to show day).
--
-- show_spend_ceilings        one ceiling, a total in £. Either one show's own
--                            (event_id) or a group's (group_name), never both.
-- show_spend_ceiling_events  a group's shows; a show is in at most one group.
--                            Only group rows have members (the script checks).
--
-- Defaults live in code (lib/mcp/meta/show-ceiling.ts), not here: one show's
-- by its exact code (SHOW_DEFAULTS: P26-BDAY), then a brand's by event-code
-- prefix (BRAND_DEFAULTS: NX, ES, EBR, AS, …). They are Matas's ruling,
-- reviewed and tested with the code that reads them. A row here is an
-- override for one show or a shared group, set by Matas with
-- scripts/set-show-ceiling.mts (dry run unless --apply). A show with a row
-- (its own or its group's) never falls back to a default.
--
-- client_spend_ceilings (268) stays in place; nothing reads it after this.
--
-- Additive only. Service role only, RLS on with no policy, like 268.

create table if not exists public.show_spend_ceilings (
  id          uuid        primary key default gen_random_uuid(),
  event_id    uuid        unique references public.events (id) on delete cascade,
  group_name  text        unique check (group_name is null or length(btrim(group_name)) between 1 and 80),
  total_gbp   numeric     not null check (total_gbp >= 0),
  note        text        check (note is null or length(note) <= 500),
  set_by      uuid        not null references auth.users (id),
  set_at      timestamptz not null default now(),
  constraint show_spend_ceilings_one_scope check (num_nonnulls(event_id, group_name) = 1)
);

create table if not exists public.show_spend_ceiling_events (
  event_id    uuid        primary key references public.events (id) on delete cascade,
  ceiling_id  uuid        not null references public.show_spend_ceilings (id) on delete cascade,
  added_by    uuid        not null references auth.users (id),
  added_at    timestamptz not null default now()
);

create index if not exists show_spend_ceiling_events_ceiling_idx
  on public.show_spend_ceiling_events (ceiling_id);

alter table public.show_spend_ceilings       enable row level security;
alter table public.show_spend_ceiling_events enable row level security;

revoke all on public.show_spend_ceilings       from anon, authenticated;
revoke all on public.show_spend_ceiling_events from anon, authenticated;

comment on table public.show_spend_ceilings is
  'Per-show spend ceilings (274): a total in GBP for one show (event_id) or a group of shows (group_name, members in show_spend_ceiling_events). Defaults (by exact code, then by event-code prefix) are in code (lib/mcp/meta/show-ceiling.ts). Set by MATAS_USER_IDS only via scripts/set-show-ceiling.mts. Service role only.';
comment on table public.show_spend_ceiling_events is
  'The shows in a shared ceiling group (274). One group per show. Service role only.';
comment on column public.show_spend_ceilings.total_gbp is
  'The most the show (or group) may have committed: spent to date + live lifetime budgets left + live daily budgets to their end or show day.';
