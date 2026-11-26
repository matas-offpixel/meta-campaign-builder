-- 275: Retargeting re-ruled to the funnel (docs/design-record/2026-11-26-retargeting-funnel.html,
-- RF1–RF9), M3c's create_retargeting.
--
-- retargeting_builds: one row per show's "{code} · Retargeting" funnel build,
-- whether the panel's Accept or the connector's create_retargeting made it.
-- It holds what the build has made so far (campaign, audiences, the Cold /
-- Warm / Hot ad sets, ads, the prospecting budgets it lowered, the stretch
-- steps it scheduled), so:
--   - a re-run from either place resumes instead of making a second campaign
--     (every Meta write is also on meta_write_idempotency, keyed on the event);
--   - a paused build, which never shows in ad_daily_insights, still counts as
--     built (plan_retargeting's "it already has a Retargeting campaign", the
--     08:00 read's running view);
--   - create_retargeting(mode: live) on a paused build only moves the money,
--     switches it on and schedules the steps.
-- `progress` holds Meta ids, pennies and audience keys only; `build` is the
-- plan it was made from (the Create line's write). No person data.
--
-- Written only by lib/retargeting/funnel-apply.ts (service role; the guard
-- test pins it). The event's owner can read their own rows.
--
-- No meta_write_idempotency op kind is added: the build reuses
-- refresh_campaign_create, refresh_adset_create, refresh_ad_create,
-- refresh_creative_create, refresh_custom_conversion_create,
-- refresh_adset_budget_update, campaign_budget_update (271),
-- adset_status_update and refresh_campaign_status_update, so the op_kind
-- CHECK is left as it is.
--
-- Additive. Not applied from this branch: ops applies it after the design PASS.

create table if not exists public.retargeting_builds (
  id                uuid        primary key default gen_random_uuid(),
  event_id          uuid        not null references public.events (id) on delete cascade,
  user_id           uuid        not null references auth.users (id) on delete cascade,
  campaign_name     text        not null,
  meta_campaign_id  text        check (meta_campaign_id is null or meta_campaign_id ~ '^[0-9]{5,32}$'),
  ad_account_id     text,
  -- The draft the write ledger keys the build's writes on (the show's on-sale draft).
  draft_id          uuid        references public.campaign_drafts (id) on delete set null,
  mode              text        check (mode is null or mode in ('paused', 'live')),
  state             text        not null default 'building' check (state in ('building', 'paused', 'live', 'failed')),
  progress          jsonb       not null default '{}'::jsonb,
  build             jsonb       not null default '{}'::jsonb,
  source            text        not null check (source in ('panel', 'connector')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint retargeting_builds_event_unique unique (event_id)
);

comment on table public.retargeting_builds is
  'One show''s Retargeting funnel build (RF1–RF9): what the panel''s Accept or create_retargeting has made, so a re-run resumes and a paused build counts as built. Migration 275.';

alter table public.retargeting_builds enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'retargeting_builds' and policyname = 'Users can read their own retargeting_builds'
  ) then
    create policy "Users can read their own retargeting_builds"
      on public.retargeting_builds for select
      using (auth.uid() = user_id);
  end if;
end $$;
