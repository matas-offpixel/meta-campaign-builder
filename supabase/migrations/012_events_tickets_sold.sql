-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012 — events.tickets_sold.
--
-- Slice U.1: surface manually-entered tickets sold + cost per ticket on the
-- event report (public + internal).
--
-- Source of truth is the agency's ticketing platform (External — Meta has
-- no signal here), so this is a simple manual integer maintained by the
-- internal team via the Reporting tab. Null = "not yet recorded" and is
-- rendered as an em-dash on the report. Cost per ticket is derived in the
-- view layer (`totalSpend / tickets_sold`); we don't materialise it.
--
-- Why a single column on `events` (not a tickets_sold timeline table):
--   - Phase 1 only needs a current snapshot. Historical pacing is a future
--     slice and would warrant its own table (`event_ticket_snapshots`),
--     not a column expansion here.
--   - `ad_plan_days.tickets_sold_cumulative` already exists for daily
--     plan-level pacing — that's a different concern (planned daily
--     tickets, scoped to an ad plan), not actual to-date sales.
--
-- Editable surface:
--   `events` already has RLS scoped to `auth.uid() = user_id`, so the
--   browser client can write this column directly via `updateEventRow` —
--   no API route needed.
-- ─────────────────────────────────────────────────────────────────────────────

alter table events
  add column if not exists tickets_sold integer;

comment on column events.tickets_sold is
  'Manually-entered actual tickets sold to date. Null = not yet recorded. Surfaces on the event report as Tickets Sold + Cost per Ticket.';

notify pgrst, 'reload schema';
