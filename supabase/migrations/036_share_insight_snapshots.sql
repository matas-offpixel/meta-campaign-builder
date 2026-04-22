-- Migration 036 — share_insight_snapshots
--
-- Point-in-time cache of the share-route Meta payload + active
-- creatives, keyed by (share_token, date_preset, custom_range).
--
-- Why this exists
--   `app/share/report/[token]/page.tsx` already declares
--   `revalidate = 300` so Next.js's ISR layer holds each
--   (token, tf) for five minutes. ISR has three operational
--   problems for this surface:
--     1. resets on every deploy (we ship multiple times a day),
--     2. is not shared across regions (a London visitor and a
--        New York visitor both pay the cold cost),
--     3. misses on every new (token, tf) combination — a client
--        flicking All time → 7d → 14d → 30d hits four cold Meta
--        fan-outs back-to-back.
--   Each cold path is 10–15s post-PR #43 (day-chunked fallback).
--   A Supabase-layer cache keyed on (token, preset, custom_range)
--   makes the second visit to any TF instant and persists across
--   deploys.
--
-- Side benefit — frozen creative thumbnails
--   The cached payload includes the active-creatives
--   `thumbnail_url` fields resolved from Meta Graph. Inside the
--   TTL window those URLs survive cache misses (we serve our own
--   row), so a CDN-level expiry on Meta's side won't blank out
--   the previews. PR 46 will harden this further by mirroring
--   the images into Supabase Storage; this migration lives
--   happily alongside that future change.
--
-- Shape notes
--   - `payload jsonb` carries the full
--     `{ metaPayload, metaErrorReason, activeCreatives }`
--     bundle the page assembles. Keeping it as a single jsonb
--     blob (rather than splitting columns) means the cache stays
--     contract-coupled to the page's render — schema migrations
--     in `lib/insights/types.ts` don't drag this table along.
--     Round-trips the existing
--     `InsightsResult / ShareActiveCreativesResult` shapes.
--   - UNIQUE (share_token, date_preset, custom_since,
--     custom_until) — one row per (token, window). NULLs in the
--     custom_* columns ARE comparable in a unique constraint
--     (Postgres treats two NULLs as distinct by default), so
--     we collapse them at write time using the conflict target
--     directly: callers always pass `custom_since`/`custom_until`
--     as either both-null (preset queries) or both-set (custom
--     queries).
--
-- Access model
--   Service-role-only. The share page is anonymous (the token
--   IS the credential), so reads + writes run via
--   `createServiceRoleClient`. The single `false`-returning RLS
--   policy is a defensive backstop — if a future change ever
--   accidentally wires a user-scoped client at this table, all
--   queries bounce instead of leaking another tenant's payload.

create table if not exists share_insight_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  share_token        text not null,
  date_preset        text not null check (date_preset in (
    'today','yesterday','last_3d','last_7d','last_14d','last_30d',
    'this_month','maximum','custom'
  )),
  custom_since       date,
  custom_until       date,
  -- Serialised payload — see top-of-file note for the contract.
  payload            jsonb not null,
  fetched_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now(),

  unique (share_token, date_preset, custom_since, custom_until)
);

-- Hot read path: route looks up by (token, preset) and trims
-- expired rows server-side. expires_at desc keeps the freshest
-- candidate first when an over-eager writer ever leaves dupes.
create index if not exists sis_token_preset_idx
  on share_insight_snapshots (share_token, date_preset, expires_at desc);

-- Sweep / GC convenience: a future cron can trim
-- `expires_at < now() - interval '1 day'` cheaply via this
-- index. Not strictly required for the read path but keeps the
-- table from growing unbounded once a token becomes inactive.
create index if not exists sis_expires_idx
  on share_insight_snapshots (expires_at);

alter table share_insight_snapshots enable row level security;

drop policy if exists sis_no_public on share_insight_snapshots;
create policy sis_no_public on share_insight_snapshots
  for all using (false);

comment on table share_insight_snapshots is
  'Point-in-time cache of the share-route Meta payload + active creatives, keyed by (share_token, date_preset, custom_range). Serves TF flicks instantly and freezes Meta CDN thumbnail URLs within the TTL window. Service-role writes only (see lib/db/share-snapshots.ts).';
