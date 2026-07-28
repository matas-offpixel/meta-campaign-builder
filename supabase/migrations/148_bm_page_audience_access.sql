-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 148 — Page-level AUDIENCE access tracking
--
-- Meta treats "can advertise on this page" and "can build audiences from this
-- page" as SEPARATE tasks on the same assigned_users edge. A page granted only
-- ADVERTISE runs ads fine but cannot be used as a Similar-Pages / engagement
-- audience seed: the audience call fails with subcode 1713140 "audience
-- creation permission missing". That is the 2026-07-27→28 symptom where the
-- wizard's audience builder silently skipped 12 seed pages that were plainly
-- visible in Ads Manager.
--
-- Migration 145's `bm_pages.user_has_access` is a single boolean derived from
-- "does the operator appear in /me/accounts for this page at all", which cannot
-- distinguish the two. This migration adds:
--
--   user_tasks               — the operator's ACTUAL page tasks (the evidence)
--   user_has_audience_access — derived flag for the audience task (the index)
--
-- ── Why store both ──────────────────────────────────────────────────────────
-- Same lesson as migration 147: Meta EXPANDS a grant (asking for one task can
-- return several), so "did the grant work?" must be a superset check against
-- the real task list, never an equality check. Keeping `user_tasks` means the
-- UI can explain what access actually exists and a future task type needs no
-- new column. The boolean stays because the dashboard counts and the PR C
-- audience-builder join both want an indexable predicate.
--
-- ── Backfill semantics (deliberately pessimistic) ────────────────────────────
-- Existing rows get `false` / `{}` — i.e. "audience access unknown, assume
-- missing" — because the flag can only be established by reading Meta. Until a
-- scan runs, the dashboard therefore over-reports missing audience access on
-- pages that may already have it. That is the safe direction: a false "missing"
-- costs one redundant grant call (Meta accepts a re-grant of an existing task),
-- whereas a false "granted" would leave the audience builder silently skipping
-- pages again, which is the exact bug being fixed.
--
-- `last_scanned_at` is cleared so every connected BM reads as never-scanned in
-- the dashboard's Last scan column — an honest signal that the new columns hold
-- no Meta-sourced data yet. The 08:00 UTC cron repopulates it, and "Sync now"
-- does so on demand. Only a display/staleness field (verified: no logic reads
-- it), so clearing it changes nothing but the operator's cue to rescan.
--
-- Reversibility:
--   alter table bm_pages drop column if exists user_has_audience_access;
--   alter table bm_pages drop column if exists user_tasks;
--
-- Idempotent: `if not exists` throughout.
-- ─────────────────────────────────────────────────────────────────────────────

alter table bm_pages
  add column if not exists user_tasks text[] not null default '{}';

alter table bm_pages
  add column if not exists user_has_audience_access boolean not null default false;

comment on column bm_pages.user_tasks is
  'The operator''s actual page tasks as read back from Meta (/me/accounts?fields=tasks). Evidence behind user_has_access + user_has_audience_access; grant verification is a superset check, never equality. Migration 148.';
comment on column bm_pages.user_has_audience_access is
  'True when user_tasks contains the page task Meta requires for audience creation. Distinct from user_has_access (ADVERTISE) — a page can be advertised on but rejected as an audience seed with subcode 1713140. Migration 148.';

-- Mirrors idx_bm_pages_missing_access from 145: the actionable set is the
-- partial one, so the dashboard's per-BM "missing audience" count and the
-- grant-all target query both stay index-only scans.
create index if not exists idx_bm_pages_missing_audience_access
  on bm_pages (business_id) where user_has_audience_access = false;

-- Force the dashboard to show every BM as needing a rescan (see note above).
update client_business_managers set last_scanned_at = null;

notify pgrst, 'reload schema';
