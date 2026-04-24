-- Total marketing budget (all channels incl. PR / influencers).
-- When null, reporting uses paid media budget only (budget_marketing).
alter table public.events
  add column total_marketing_budget numeric(12, 2);

comment on column public.events.total_marketing_budget is
  'Optional cap across paid media + additional spend; null = use budget_marketing only in reporting.';
