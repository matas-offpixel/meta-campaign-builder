-- Migration 208 — tag_performance.events_n
--
-- Distinct real shows behind a tag row, the same rule as
-- copy_performance: one ad counts toward one event, events on the same
-- date at the same venue are one show, and a cancelled or undated event
-- is not a show. The rail can say "n shows". funded_ads stays the
-- shrinkage n.
--
-- Apply by hand. Not applied by this branch.

alter table tag_performance
  add column if not exists events_n integer not null default 0;

comment on column tag_performance.events_n is
  'Distinct real shows behind the ads. One ad counts toward one event. Same date and venue are one show. Cancelled and undated events are excluded. Migration 208.';
