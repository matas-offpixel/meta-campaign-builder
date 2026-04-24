-- Legacy column: was an optional cap across paid media + additional spend.
-- Deprecated (2026-04): total marketing is computed as plan paid media +
-- sum(additional_spend) entry amounts; this column is unused but retained for
-- a possible future feature flag / migration path.
alter table public.events
  add column total_marketing_budget numeric(12, 2);

comment on column public.events.total_marketing_budget is
  'DEPRECATED — unused. Total marketing is derived live; column kept for future use.';
