-- Migration 041 — active_creatives_snapshots
--
-- New cache table that decouples the public share-report render path
-- from live Meta Graph fan-outs. Rationale captured in
-- `docs/META_INDEPENDENCE_RESEARCH.md` (Option 1 — recommended).
--
-- Why a NEW table instead of extending share_insight_snapshots:
--   * Different cache key. share_insight_snapshots is per-share-token
--     by design (different tokens can show subsets of the same event).
--     Keying active-creatives by share_token doubles the row count and
--     halves cache utility — multiple tokens can target the same event
--     and the underlying creative data is event-scoped, not
--     share-scoped. Key by event_id.
--   * Different refresh cadence. Headline metaPayload (small, cheap)
--     stays at the existing 5-min TTL. Active creatives (large
--     payload, expensive Meta fan-out) move to a 6h cron-driven
--     cadence with a 2h tighten inside 14 days of show date.
--   * Stale-while-revalidate semantics. The new table carries an
--     `is_stale` flag that the share page reads to decide whether to
--     fire a background refresh; share_insight_snapshots' TTL is a
--     bust-on-expiry pattern with no concept of "serve stale, refresh
--     in the background". Two different access patterns → two
--     different tables, even though the underlying jsonb-blob storage
--     pattern is identical.
--
-- Cache key: `(event_id, date_preset, custom_since, custom_until)`.
-- NULLS NOT DISTINCT so the preset rows (custom_since=NULL,
-- custom_until=NULL) collide correctly on upsert — same fix migration
-- 037 applied to share_insight_snapshots.
--
-- RLS: service role only. Defensive backstop policy — the table is
-- written by `/api/cron/refresh-active-creatives` and `/api/internal/
-- refresh-active-creatives` and read by `app/share/report/[token]/
-- page.tsx` via the service-role client. No user session ever
-- touches it directly. Mirrors share_insight_snapshots's posture.
--
-- Apply manually post-merge via the Supabase MCP. Idempotent: every
-- statement is `IF NOT EXISTS` or wrapped in a DO block that
-- re-checks pg_constraint / pg_trigger.

create table if not exists active_creatives_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  date_preset        text not null,
  -- Date columns rather than text — Postgres `date` keeps the column
  -- typed, indexable, and aligned with how `CustomDateRange.{since,
  -- until}` is shaped at the application layer (YYYY-MM-DD strings
  -- that Postgres parses transparently). NULL for every non-custom
  -- preset; the unique-key NULLS NOT DISTINCT semantics (added below)
  -- make those NULLs collide correctly.
  custom_since       date,
  custom_until       date,
  -- Stored as a single jsonb blob (not split columns) for the same
  -- reason share_insight_snapshots does it: the cache stays
  -- contract-coupled to the page's render shape, and a stale row
  -- from a previous deploy that no longer parses just won't hit
  -- because the page would compute a different payload anyway.
  -- Carries the full discriminated `ShareActiveCreativesResult`
  -- (kind: ok | skip | error) so a fast/healthy hit is renderable
  -- without re-running the Meta call.
  payload            jsonb not null,
  fetched_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  -- Last cron / manual-refresh attempt's error message, if any.
  -- Kept for ops visibility only — readers never gate on this; it's
  -- diagnostic. Cleared on the next successful write.
  last_refresh_error text,
  -- Stale-while-revalidate flag. The cron / internal refresh route
  -- flips this to TRUE when a refresh is enqueued (so concurrent
  -- share-page loads don't all kick their own background fetch and
  -- self-DDoS) and back to FALSE on successful write. Readers serve
  -- the stored payload regardless — `expires_at` is advisory for the
  -- background refresher, not a cache-bust for readers.
  is_stale           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Unique key on the read path. NULLS NOT DISTINCT (PG 15+) ensures
-- two preset rows with `(custom_since, custom_until) = (NULL, NULL)`
-- collide correctly on upsert. Named explicitly so future migrations
-- can reference it without the catalog dance migration 037 had to
-- do for share_insight_snapshots.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.active_creatives_snapshots'::regclass
      and conname = 'active_creatives_snapshots_event_window_key'
  ) then
    execute
      'alter table public.active_creatives_snapshots '
      'add constraint active_creatives_snapshots_event_window_key '
      'unique nulls not distinct '
      '(event_id, date_preset, custom_since, custom_until)';
  end if;
end $$;

comment on constraint active_creatives_snapshots_event_window_key
  on active_creatives_snapshots is
  'Unique cache key for the active-creatives snapshot store. NULLS NOT DISTINCT so preset queries (custom_since=NULL, custom_until=NULL) collide correctly on upsert. See migration 041 for the rationale.';

-- Read-path index. The share page filters on `event_id` + `date_preset`
-- and orders by `expires_at` to pick the freshest row when the unique
-- constraint hasn't been enforced yet (defensive — should always be
-- one row per key, but the order keeps the read deterministic).
create index if not exists acs_event_preset_idx
  on active_creatives_snapshots (event_id, date_preset, expires_at desc);

-- Owner-side index. Cron joins by `user_id` when batching refreshes
-- per OAuth token (the per-account rate budget is per token, not per
-- event). Cheap to maintain at this row count.
create index if not exists acs_user_id_idx
  on active_creatives_snapshots (user_id);

-- ── RLS — service role only, defensive backstop ──────────────────────
alter table active_creatives_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'active_creatives_snapshots'
      and policyname = 'service role only'
  ) then
    execute
      'create policy "service role only" on active_creatives_snapshots '
      'for all using (false) with check (false)';
  end if;
end $$;

-- ── updated_at trigger ───────────────────────────────────────────────
-- Mirrors the bumpkeeper pattern used elsewhere — keeps `updated_at`
-- fresh without relying on every writer to set it explicitly. Helps
-- ops triage ("when was this row last touched") without parsing the
-- jsonb payload.
create or replace function set_acs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.active_creatives_snapshots'::regclass
      and tgname = 'acs_updated_at'
  ) then
    execute
      'create trigger acs_updated_at '
      'before update on active_creatives_snapshots '
      'for each row execute function set_acs_updated_at()';
  end if;
end $$;
