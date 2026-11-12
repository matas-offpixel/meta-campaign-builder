-- Migration 232 — the on-sale refresh: proposals and their lines (P1, shadow only)
--
-- docs/design-record/2026-11-12-on-sale-refresh.html, R2, R4, R6, HR2.
-- One proposal per campaign per refresh (the campaign is its name on this
-- event: a campaign rebuilt under the same name is the same campaign).
-- Each line carries its kind, target, evidence snapshot and the write it
-- would make, so P5 can score it on the next full week. P1 stores shadow
-- proposals and shows them read-only; no line is ever applied here.
--
-- Write only. Not applied from this branch. Ops applies from main.
-- 231 is the migration this follows.

create table if not exists public.onsale_refresh_proposals (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  event_id          uuid not null references public.events (id) on delete cascade,
  campaign_key      text not null,
  campaign_ids      text[] not null default '{}',
  run_kind          text not null check (run_kind in ('cycle', 'mid_cycle', 'shadow')),
  run_day           date not null,
  cycle_monday      date not null,
  cycle_kind        text not null check (cycle_kind in ('payday', 'content')),
  window_start      date not null,
  window_end        date not null,
  mode              text not null default 'shadow' check (mode in ('shadow', 'live')),
  objective         text not null check (objective in ('initiate_checkout', 'landing_page_view', 'complete_registration')),
  why               jsonb not null default '{}',
  blockers          jsonb not null default '[]',
  enough_data       boolean not null default true,
  not_enough_data   text,
  next_check        date,
  campaign_summary  text,
  inputs            jsonb not null default '{}',
  watch             jsonb not null default '{}',
  notes             jsonb not null default '{}',
  slack_posted_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (event_id, campaign_key, run_kind, window_end)
);

comment on table public.onsale_refresh_proposals is
  'One on-sale refresh proposal per campaign per run (R2). Shadow by default; P1 never applies a line. Migration 232.';
comment on column public.onsale_refresh_proposals.campaign_key is
  'The campaign name on this event. A campaign rebuilt under the same name is the same campaign; campaign_ids lists every Meta id behind it.';
comment on column public.onsale_refresh_proposals.run_kind is
  'cycle: the cycle Monday refresh. mid_cycle: the Monday between. shadow: started by hand, reads the data to the day before.';
comment on column public.onsale_refresh_proposals.why is
  'R3: the objective sentence, the Purchase sentence and the moves sentence, with the counts they quote.';
comment on column public.onsale_refresh_proposals.inputs is
  'The evidence snapshot the proposal was built from (campaign, ad set and creative figures for the window and since on sale), for R6.';
comment on column public.onsale_refresh_proposals.enough_data is
  'False when the campaign logged fewer than the phase floor of results in the window: supply lines only.';

create index if not exists onsale_refresh_proposals_event_idx
  on public.onsale_refresh_proposals (event_id, created_at desc);

create table if not exists public.onsale_refresh_lines (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.onsale_refresh_proposals (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  position        integer not null,
  kind            text not null check (kind in ('add_creative', 'claim_ready', 'pause_creative', 'bring_back_audience', 'missing_default', 'drop_audience', 'move_budget')),
  rule_id         text not null,
  title           text not null,
  detail          text not null,
  write_text      text not null,
  target          jsonb not null default '{}',
  evidence        jsonb not null default '{}',
  write           jsonb,
  adds_spend      boolean not null default false,
  blocked_reason  text,
  supply          boolean not null default false,
  state           text not null default 'to_review' check (state in ('to_review', 'accepted', 'rejected', 'applied', 'failed', 'expired')),
  reason          text,
  decided_by      uuid,
  decided_at      timestamptz,
  applied_result  jsonb,
  outcome         jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.onsale_refresh_lines is
  'One line of an on-sale refresh proposal (R2, HR2): kind, target, evidence, the write it would make, and its state. Migration 232.';
comment on column public.onsale_refresh_lines.state is
  'To review · Accepted · Rejected · Applied · Failed · Expired (R4). P1 writes to_review and, at the next refresh, expired.';
comment on column public.onsale_refresh_lines.blocked_reason is
  'R5: set when the line cannot be accepted yet, e.g. the event has no marketing budget and the line adds spend.';
comment on column public.onsale_refresh_lines.outcome is
  'R6: how the line scored on the next full week. Null until P5 writes it.';

create index if not exists onsale_refresh_lines_proposal_idx
  on public.onsale_refresh_lines (proposal_id, position);

do $$
declare
  t text;
begin
  foreach t in array array['onsale_refresh_proposals', 'onsale_refresh_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = format('Users can read their own %s', t)
    ) then
      execute format(
        'create policy %I on public.%I for select using (auth.uid() = user_id)',
        format('Users can read their own %s', t),
        t
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
