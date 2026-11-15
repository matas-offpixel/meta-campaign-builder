-- Migration 236 — the on-sale refresh, P2: Accept, Reject and Apply for creatives
--
-- docs/design-record/2026-11-12-on-sale-refresh.html, R4, R5, R6, HR2, HR4, HR5.
-- Builds on 232 (proposals and lines). 234 and 235 are taken by #1217 and
-- #1218, so this is 236.
--
-- 1. onsale_refresh_arms: the per-event arm, Shadow or Live (R4). Live also
--    needs ONSALE_REFRESH_APPLY_ENABLED = "1" on the deployment; nothing
--    applies without Matas's click either way.
-- 2. onsale_refresh_lines: the Reject reason (Too early · Wrong creative ·
--    Claim not right · Other, with optional text), when it was applied,
--    and a transient 'applying' state so two clicks can't apply one line
--    twice. applied_result keeps the ad ids created or paused (R6).
-- 3. meta_write_idempotency: three new op kinds, so a double click or a
--    retry never doubles an ad or re-sends a status write.
--
-- Writes go through the service role after the route checks the event's
-- owner; the authenticated role keeps read-only RLS, as in 232.
--
-- Write only. Not applied from this branch. Ops applies from main.

create table if not exists public.onsale_refresh_arms (
  event_id    uuid primary key references public.events (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  mode        text not null default 'shadow' check (mode in ('shadow', 'live')),
  armed_by    uuid,
  armed_at    timestamptz,
  updated_at  timestamptz not null default now()
);

comment on table public.onsale_refresh_arms is
  'The on-sale refresh per-event arm (R4): shadow (the default) or live. Live applies only with ONSALE_REFRESH_APPLY_ENABLED = "1" and Matas''s Apply click. Migration 236.';

alter table public.onsale_refresh_arms enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onsale_refresh_arms' and policyname = 'Users can read their own onsale_refresh_arms'
  ) then
    execute 'create policy "Users can read their own onsale_refresh_arms" on public.onsale_refresh_arms for select using (auth.uid() = user_id)';
  end if;
end $$;

alter table public.onsale_refresh_lines
  add column if not exists reject_reason text,
  add column if not exists reject_note   text,
  add column if not exists applied_at    timestamptz;

alter table public.onsale_refresh_lines
  drop constraint if exists onsale_refresh_lines_reject_reason_check;
alter table public.onsale_refresh_lines
  add constraint onsale_refresh_lines_reject_reason_check
  check (reject_reason is null or reject_reason in ('too_early', 'wrong_creative', 'claim_not_right', 'other'));

alter table public.onsale_refresh_lines
  drop constraint if exists onsale_refresh_lines_state_check;
alter table public.onsale_refresh_lines
  add constraint onsale_refresh_lines_state_check
  check (state in ('to_review', 'accepted', 'rejected', 'applying', 'applied', 'failed', 'expired'));

comment on column public.onsale_refresh_lines.state is
  'To review · Accepted · Rejected · Applied · Failed · Expired (R4). applying is held only while Apply runs the line, so a second click finds nothing to claim.';
comment on column public.onsale_refresh_lines.reject_reason is
  'HR5: too_early · wrong_creative · claim_not_right · other. reject_note is the optional text.';
comment on column public.onsale_refresh_lines.applied_result is
  'What Apply did (R6 from day one): the Meta ad ids created or paused, the ad sets written, skipped ad sets, and on a failure the plain-words reason and Meta''s raw message.';

create index if not exists onsale_refresh_lines_state_idx
  on public.onsale_refresh_lines (state, kind);

alter table public.meta_write_idempotency
  drop constraint if exists meta_write_idempotency_op_kind_check;

alter table public.meta_write_idempotency
  add constraint meta_write_idempotency_op_kind_check
  check (op_kind in (
    'campaign_create',
    'adset_create',
    'ad_create',
    'creative_upload',
    'adset_targeting_update',
    'adset_destination_update',
    'refresh_creative_create',
    'refresh_ad_create',
    'ad_status_update'
  ));

notify pgrst, 'reload schema';
