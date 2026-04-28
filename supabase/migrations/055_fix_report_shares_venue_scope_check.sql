-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 055 — repair report_shares venue scope constraint.
--
-- Migration 052 added `scope='venue'`, but production can still have the
-- original named `report_shares_scope_check` constraint from migration 014:
--   CHECK (scope in ('event', 'client'))
--
-- Because 052 only dropped differently named scope constraints, the old named
-- constraint survived and venue share inserts fail with:
--   violates check constraint "report_shares_scope_check"
--
-- Force-replace the named constraint idempotently.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.report_shares
  drop constraint if exists report_shares_scope_check;

alter table public.report_shares
  add constraint report_shares_scope_check
  check (scope in ('event', 'client', 'venue'));

notify pgrst, 'reload schema';
