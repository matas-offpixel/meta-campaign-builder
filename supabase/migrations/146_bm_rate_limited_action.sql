-- Migration 146 — BM grant-all rate-limit halt (action='rate_limited')
--
-- Widens bm_page_access_events.action to allow 'rate_limited', written by
-- grantPagesForBusinessManager (lib/bm/grant.ts) when Meta returns a
-- #4/#17/#80004 quota error mid-batch.
--
-- Incident (2026-07-09): the grant-all worker for Columbo Group
-- (527693220707294) hit Meta's app-tier "(#4) Application request limit
-- reached" after 8 successful grants, then kept looping through the rest
-- of the batch — 200+ sync_error rows logged for the same rejected quota
-- window, deepening the rate-limit hole instead of backing off. The worker
-- now HALTS the batch immediately on this signal and logs a single
-- 'rate_limited' event marking exactly where the run stopped, with the
-- estimated retry-after in `detail`.
--
-- Reversibility:
--   alter table bm_page_access_events drop constraint bm_page_access_events_action_check;
--   alter table bm_page_access_events add constraint bm_page_access_events_action_check
--     check (action in ('granted', 'revoked', 'detected_new', 'sync_error'));
--   -- (only safe once no 'rate_limited' rows remain)
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent — introspects pg_constraint for the existing check constraint
-- on `action` rather than assuming its auto-generated name.

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'bm_page_access_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%action%';

  if v_conname is not null then
    execute format('alter table bm_page_access_events drop constraint %I', v_conname);
  end if;

  alter table bm_page_access_events
    add constraint bm_page_access_events_action_check
    check (action in ('granted', 'revoked', 'detected_new', 'sync_error', 'rate_limited'));
end $$;

notify pgrst, 'reload schema';
