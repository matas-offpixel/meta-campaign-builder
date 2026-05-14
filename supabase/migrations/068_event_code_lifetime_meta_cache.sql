-- Migration 068 — per-event_code lifetime Meta metrics cache
--
-- Surface: 4thefans WC26 venue cards reconciling to Meta Ads Manager.
--
-- Why a new table rather than columns on `events` (Plan PR #414 §2.1
-- Option B): the metric is per-`event_code`, NOT per-event. A 4-fixture
-- venue (e.g. WC26-LONDON-SHEPHERDS) shares ONE campaign-window
-- deduplicated reach number across all four siblings. Encoding that on
-- `events` would force every sibling row to carry the same value and
-- invite a future maintainer to sum the column across siblings — exactly
-- the N-counting bug that PR #413 + this PR are meant to put down for
-- good. A `(client_id, event_code)` PK makes the per-event_code semantic
-- explicit and unambiguous.
--
-- Cache scope (Q3 in the Plan PR — "anything deduplicated-people"):
--   - `meta_reach`               — Meta-deduped unique users.
--   - `meta_impressions`         — additive across days; cached too for
--                                  consistency with the Reach cell's
--                                  refreshed lifetime semantics.
--   - `meta_link_clicks`         — Meta returns campaign-deduped clicks at
--                                  lifetime granularity (clicks-from-the-
--                                  same-user-within-the-attribution-window
--                                  collapse). Cached per Q3.
--   - `meta_regs`                — same shape as link_clicks (Meta's
--                                  conversion attribution dedupes).
--   - `meta_video_plays_3s`      — additive but cached for consistency.
--   - `meta_video_plays_15s`     — same.
--   - `meta_video_plays_p100`    — same.
--   - `meta_engagements`         — Meta dedupes within campaign / per
--                                  attribution window.
--
-- Refresh cadence: written by `runRollupSyncForEvent` once per
-- `(client_id, event_code)` per cron tick. The runner short-circuits
-- subsequent siblings within the same tick by checking `fetched_at`,
-- so a 4-fixture venue triggers ONE Meta lifetime call per cron tick,
-- not four.
--
-- Stale-data posture: readers should treat `fetched_at < now() - 7d`
-- as suspicious (no cron tick in a week) but still display the cached
-- value with a "last synced" indicator — the alternative is "—" on
-- the venue card every time the cron is unhealthy.
--
-- RLS: row-level reads gated on `clients.user_id = auth.uid()`. The
-- service-role client (used by the cron runner and the share-token
-- portal loader) bypasses RLS and is the only writer.

create table if not exists event_code_lifetime_meta_cache (
  client_id uuid not null references clients(id) on delete cascade,
  event_code text not null,

  -- All counts use bigint because Meta lifetime impressions can exceed
  -- 2.1B for high-budget brand campaigns; reach can too once a venue's
  -- audience expands past the 32-bit signed range. The daily rollup
  -- columns are integer because per-day values stay well under that.
  meta_reach bigint,
  meta_impressions bigint,
  meta_link_clicks bigint,
  meta_regs bigint,
  meta_video_plays_3s bigint,
  meta_video_plays_15s bigint,
  meta_video_plays_p100 bigint,
  meta_engagements bigint,

  -- Diagnostic — comma-separated list of the campaign names that
  -- contributed to the lifetime totals. Lets ops eyeball whether the
  -- right campaigns matched without re-running the helper. JSON array
  -- so a future migration can extend the per-campaign breakdown if
  -- needed without column-add gymnastics.
  campaign_names jsonb not null default '[]'::jsonb,

  -- When the lifetime fetch last ran successfully (or partial — see the
  -- runner). Drives the cron's "skip recently-cached venues" guard
  -- AND the venue page's "last synced" indicator.
  fetched_at timestamptz not null default now(),

  -- When the row was first inserted (vs. updated). Useful for debugging
  -- "did the backfill run for this venue?" without diff-ing fetched_at.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (client_id, event_code)
);

create index if not exists event_code_lifetime_meta_cache_fetched_at_idx
  on event_code_lifetime_meta_cache (fetched_at desc);

create or replace function set_event_code_lifetime_meta_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_event_code_lifetime_meta_cache_updated_at
  on event_code_lifetime_meta_cache;

create trigger set_event_code_lifetime_meta_cache_updated_at
before update on event_code_lifetime_meta_cache
for each row
execute function set_event_code_lifetime_meta_cache_updated_at();

alter table event_code_lifetime_meta_cache enable row level security;

-- Read policy: every authenticated user can SELECT the rows whose
-- client they own. The portal loader uses the service-role client
-- (bypassing RLS) so the policy only matters for direct dashboard
-- reads through `lib/supabase/server.ts createSupabaseServerClient`.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'event_code_lifetime_meta_cache'
      and policyname = 'read own client'
  ) then
    execute
      'create policy "read own client" on event_code_lifetime_meta_cache ' ||
      'for select using ( ' ||
      '  exists ( ' ||
      '    select 1 from clients ' ||
      '    where clients.id = event_code_lifetime_meta_cache.client_id ' ||
      '      and clients.user_id = auth.uid() ' ||
      '  ) ' ||
      ')';
  end if;
end $$;

-- Write policy: writes are service-role only. RLS applied via a default
-- "deny all to non-service-role" — the supabase service-role client
-- bypasses RLS so the policy stays restrictive for owner sessions.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'event_code_lifetime_meta_cache'
      and policyname = 'service-role write only'
  ) then
    execute
      'create policy "service-role write only" on event_code_lifetime_meta_cache ' ||
      'for all using (false) with check (false)';
  end if;
end $$;

notify pgrst, 'reload schema';
