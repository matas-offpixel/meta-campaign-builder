-- Migration 240 — campaign → event overrides (dashboard v2, HN2 attribution)
--
-- docs/design-record/2026-11-13-dashboard-v2-against-the-model.html and
-- #1225's reconciliation: a campaign named for the wrong show, or with no
-- [CODE] at all, lands on the wrong event or on none. This table says which
-- event a platform campaign belongs to, and it is read BEFORE name matching:
--   - the TikTok rollup leg (lib/tiktok/rollup-insights.ts) counts a
--     campaign for an event when its override names that event, never for
--     another event, and falls back to the [CODE] in the name only when the
--     campaign has no override;
--   - the dashboard v2 calc (lib/dashboard/sales-calc) applies the same
--     rule to Meta and Google campaigns.
--
-- 240, not 239: P5 may hold 239 (the brief for this branch says so), and no
-- open PR held a 239 when this was written.
--
-- Read-only in code. Ops writes the rows (the seed SQL is in the PR body),
-- service role only. Write only. Not applied from this branch.

create table if not exists public.campaign_event_overrides (
  platform     text not null check (platform in ('meta', 'tiktok', 'google')),
  campaign_id  text not null check (campaign_id <> ''),
  event_id     uuid not null references public.events (id) on delete cascade,
  note         text,
  created_at   timestamptz not null default now(),
  primary key (platform, campaign_id)
);

comment on table public.campaign_event_overrides is
  'Which event a platform campaign belongs to, read before [CODE] name matching (dashboard v2 HN2, migration 240). One event per campaign. Ops writes rows; the app only reads.';

create index if not exists campaign_event_overrides_event
  on public.campaign_event_overrides (event_id);

alter table public.campaign_event_overrides enable row level security;

drop policy if exists campaign_event_overrides_select_own on public.campaign_event_overrides;
create policy campaign_event_overrides_select_own on public.campaign_event_overrides
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

-- No insert, update or delete policy: service role only.
