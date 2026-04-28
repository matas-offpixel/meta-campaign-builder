-- Migration 051: drop deprecated events.total_marketing_budget.
--
-- This column was added in migration 045 as an optional cap across
-- paid media + additional spend. Since PR #109 the figure has been
-- computed live from `event_ad_plans.budget_paid_media` +
-- `sum(additional_spend_entries.amount)` — the stored column was
-- never read by any app code. A repo-wide grep against main shows
-- zero callers before this migration ran; the only remaining
-- references are in the auto-generated Supabase type file, which
-- gets regenerated after this drop and will stop listing the
-- column.
--
-- Low-risk drop: no backfill needed, no stored procedures read it,
-- and RLS policies don't reference it. If a future feature brings
-- back an explicit marketing budget cap we can re-add a fresh
-- column; squatting on a deprecated one solves nothing.

alter table public.events
  drop column if exists total_marketing_budget;
