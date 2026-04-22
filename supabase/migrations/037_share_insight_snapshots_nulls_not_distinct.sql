-- Migration 037 — share_insight_snapshots NULLS NOT DISTINCT fix
--
-- Bug it fixes
--   Migration 036 added `unique (share_token, date_preset,
--   custom_since, custom_until)`. PostgreSQL's default behaviour
--   treats two NULLs as DISTINCT for unique-constraint purposes
--   (matches the SQL spec, but isn't what most apps want), so for
--   every preset query — every row of which has both
--   `custom_since` and `custom_until` set to NULL — the unique
--   constraint never matched. Two side effects in production:
--
--     1. `readShareSnapshot` filters with `.eq("custom_since", null)`
--        which PostgREST translates to `WHERE custom_since = NULL`
--        (always false) — so reads were 100% miss-rate. (Fixed in
--        the application layer in this PR; see
--        `lib/db/share-snapshots.ts`.)
--
--     2. `writeShareSnapshot`'s `.upsert(..., { onConflict: ... })`
--        relies on the unique index to find the existing row to
--        replace. With NULLS DISTINCT, the existing row never
--        matched the new one's key (NULL ≠ NULL), so every miss
--        → fetch → write inserted a fresh row. We saw 8 dupes for
--        the same (token, preset, NULL, NULL) tuple accumulate in
--        45s of testing.
--
--   Fix: replace the unique constraint with the PG 15+
--   `UNIQUE NULLS NOT DISTINCT` variant. Same column set, same
--   conflict target string from the application — only the
--   semantics of NULL change. After the swap, two preset rows
--   with `(custom_since, custom_until) = (NULL, NULL)` collide
--   correctly and the upsert replaces in place.
--
-- Steps
--   1. Dedupe existing rows. PARTITION BY treats NULL as a
--      single value (the PG window-function behaviour we want
--      here, distinct from the unique-constraint NULLS DISTINCT
--      default), so the per-key partition correctly groups all
--      preset dupes together. Keep the freshest by
--      `fetched_at DESC`, tie-break on `id DESC` for determinism.
--   2. Drop ANY existing unique constraint on the table. We
--      know there's only one (the 036 one), but iterating
--      catalog defensively is more durable than guessing PG's
--      63-char truncated default name.
--   3. Add the replacement constraint with a stable explicit
--      name + `NULLS NOT DISTINCT`.
--
-- Apply manually post-merge via Supabase MCP (same as 036).
-- Idempotent: dedupe is a no-op when there are no dupes; the
-- DO-block drop is a no-op when no matching constraint exists;
-- ADD CONSTRAINT will error on re-run, so wrap in IF NOT EXISTS
-- by checking pg_constraint before adding.

-- Step 1: dedupe.
with ranked as (
  select
    id,
    row_number() over (
      partition by share_token, date_preset, custom_since, custom_until
      order by fetched_at desc, id desc
    ) as rn
  from share_insight_snapshots
)
delete from share_insight_snapshots
where id in (select id from ranked where rn > 1);

-- Step 2: drop the existing unique constraint, whatever its name.
do $$
declare
  con_rec record;
begin
  for con_rec in
    select conname
    from pg_constraint
    where conrelid = 'public.share_insight_snapshots'::regclass
      and contype = 'u'
  loop
    execute format(
      'alter table public.share_insight_snapshots drop constraint %I',
      con_rec.conname
    );
  end loop;
end $$;

-- Step 3: add the NULLS NOT DISTINCT replacement under a stable
-- explicit name so future migrations can reference it directly
-- instead of doing the catalog dance again.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.share_insight_snapshots'::regclass
      and conname = 'share_insight_snapshots_token_window_key'
  ) then
    execute
      'alter table public.share_insight_snapshots '
      'add constraint share_insight_snapshots_token_window_key '
      'unique nulls not distinct '
      '(share_token, date_preset, custom_since, custom_until)';
  end if;
end $$;

comment on constraint share_insight_snapshots_token_window_key
  on share_insight_snapshots is
  'Unique cache key for the share-route snapshot store. NULLS NOT DISTINCT so preset queries (custom_since=NULL, custom_until=NULL) collide correctly on upsert. See migration 037 for the rationale.';
