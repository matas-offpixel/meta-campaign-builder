-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 149 — Per-page task capture + grant audit trail
--
-- Numbering note: applied to prod on 2026-07-28 20:58 UTC and recorded in the
-- ledger as `148_bm_page_task_audit` (timestamp 20260728205821), because another
-- thread claimed 148 the same evening (20:30, thumbnail-hash index) while this
-- branch was still open. Per MIGRATIONS_NOTES.md the numeric prefix is a
-- readability convention only, so the FILE is renumbered to 149 to keep this
-- folder ordered; the ledger name is left as applied.
--
-- Migration 145's `bm_pages.user_has_access` is a single boolean meaning "the
-- operator appears in /me/accounts for this page at all". That is too coarse to
-- answer the question the wizard's audience builder keeps failing on: WHICH
-- capabilities does the operator actually hold on this page? This migration
-- stores the task list itself, plus what the last grant asked for.
--
-- ── Why this migration is not what it was originally scoped as ──────────────
-- The brief for this PR assumed Meta exposed a dedicated page task for audience
-- creation ("AUDIENCE_MANAGE") that simply needed granting, and this migration
-- was originally a `user_has_audience_access` boolean. A live capture against
-- Graph v23.0 on 2026-07-28 disproved that. Posting an invalid task to
-- `POST /{pageId}/assigned_users` makes Meta enumerate what it accepts:
--
--   FULL_CONTROL, CONTENT, MESSAGES, COMMUNITY_ACTIVITY, ADVERTISE, ANALYZE,
--   IG_APP_ADMIN, IG_APP, SPARK_INSIGHTS, SPARK_PUBLISH, SPARK_EVERYTHING,
--   CREATOR_MANAGEMENT, CREATIVE_MANAGEMENT
--
-- There is NO audience task in that list, so subcode 1713140 ("audience
-- creation permission missing") is caused by something other than a missing
-- page user-task — most likely a business-level asset condition. A boolean
-- named after a task that does not exist would have been a lie in the schema,
-- so this migration stores EVIDENCE instead of a verdict, and the follow-up PR
-- diagnoses 1713140 empirically against that evidence.
--
-- ── Columns ─────────────────────────────────────────────────────────────────
--   user_tasks                  the operator's real tasks, from
--                               /me/accounts?fields=id,name,tasks — a field the
--                               scan was ALREADY requesting and discarding, so
--                               capturing it costs zero extra Graph calls
--   last_grant_requested_tasks  what the most recent grant asked Meta for
--   last_grant_at               when that grant ran
--
-- The (requested, observed) pair is the point. Meta EXPANDS grants — PR #726
-- verified that one requested ADVERTISE on an IG asset read back as five tasks —
-- so the delta between what we asked for and what `user_tasks` reports is the
-- only reliable record of what Meta actually did. That delta is what the
-- 1713140 investigation needs: correlate "pages where audience creation fails"
-- against "tasks the operator verifiably holds".
--
-- Backfill: `user_tasks` starts empty and is populated by the next scan (the
-- 08:00 UTC cron, or "Sync now"). `last_scanned_at` is cleared so every
-- connected BM reads as never-scanned in the dashboard — an honest signal that
-- these columns hold no Meta-sourced data yet. Verified that nothing but the
-- dashboard's display reads that field.
--
-- Reversibility:
--   alter table bm_pages drop column if exists user_tasks;
--   alter table bm_pages drop column if exists last_grant_requested_tasks;
--   alter table bm_pages drop column if exists last_grant_at;
--
-- Idempotent: `if not exists` throughout.
-- ─────────────────────────────────────────────────────────────────────────────

alter table bm_pages
  add column if not exists user_tasks text[] not null default '{}';

alter table bm_pages
  add column if not exists last_grant_requested_tasks text[];

alter table bm_pages
  add column if not exists last_grant_at timestamptz;

comment on column bm_pages.user_tasks is
  'The operator''s actual page tasks as read back from Meta (/me/accounts?fields=tasks). Evidence, not a verdict: Meta expands grants, so any "did it work?" check is a superset test against this, never equality. Migration 149.';
comment on column bm_pages.last_grant_requested_tasks is
  'Tasks the most recent grant ASKED Meta for. Compare against user_tasks to see what Meta actually did (it expands, and silently ignores some requests). Migration 149.';
comment on column bm_pages.last_grant_at is
  'When last_grant_requested_tasks was submitted. Null = never granted through this tool. Migration 149.';

-- GIN so the follow-up 1713140 investigation can ask containment questions
-- ("every page where the operator holds ADVERTISE but not ANALYZE") across
-- ~50 BMs without a full scan per query.
create index if not exists idx_bm_pages_user_tasks_gin
  on bm_pages using gin (user_tasks);

-- Force the dashboard to show every BM as needing a rescan (see note above).
update client_business_managers set last_scanned_at = null;

notify pgrst, 'reload schema';
