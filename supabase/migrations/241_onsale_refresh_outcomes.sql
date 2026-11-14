-- Migration 241 — the on-sale refresh, P5: learning from its own moves
--
-- docs/design-record/2026-11-12-on-sale-refresh.html, R6 and HR6.
-- One outcome per refresh line (shadow, rejected and applied alike),
-- judged on the next full Monday–Sunday week of ad_daily_insights after
-- the line's proposal (or after Apply), from the line's stored evidence.
-- A line that can't be judged gets outcome 'unknown' with its reason;
-- unknown never counts towards a track record.
--
-- Written nightly by /api/cron/learning-refresh behind
-- ENABLE_ONSALE_REFRESH_SCORING = "1" (default off). Re-scoring a line
-- updates its one row (unique line_id), never adds a second.
--
-- 240 is the latest on main (239 is unused); no open PR holds a later
-- number. Write only. Not applied from this branch. Ops applies from main.

create table if not exists public.onsale_refresh_outcomes (
  id           uuid primary key default gen_random_uuid(),
  line_id      uuid not null unique references public.onsale_refresh_lines (id) on delete cascade,
  proposal_id  uuid not null references public.onsale_refresh_proposals (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  event_id     uuid not null references public.events (id) on delete cascade,
  client_id    uuid references public.clients (id) on delete set null,
  -- The line's rule (onsale_refresh_lines.rule_id) and kind, so a track record is a read of this table alone.
  rule_id      text not null,
  kind         text not null,
  -- Whether the line's write was made (applied, or failed part-way with ads live); otherwise its counterfactual was judged.
  applied      boolean not null default false,
  outcome      text not null check (outcome in ('right', 'wrong', 'unknown')),
  reason       text not null,
  week_from    date not null,
  week_to      date not null,
  -- The figures compared: the subject's and the campaign's cost per result, the bar, the counts.
  figures      jsonb not null default '{}',
  scored_at    timestamptz not null default now()
);

comment on table public.onsale_refresh_outcomes is
  'R6: how each on-sale refresh line scored on the next full week (right / wrong / unknown with a reason), from its stored evidence. One row per line. Feeds the per rule × client track record. Migration 241.';

create index if not exists onsale_refresh_outcomes_client_rule_idx
  on public.onsale_refresh_outcomes (client_id, rule_id, outcome);

alter table public.onsale_refresh_outcomes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onsale_refresh_outcomes' and policyname = 'Users can read their own onsale_refresh_outcomes'
  ) then
    execute 'create policy "Users can read their own onsale_refresh_outcomes" on public.onsale_refresh_outcomes for select using (auth.uid() = user_id)';
  end if;
end $$;

notify pgrst, 'reload schema';
