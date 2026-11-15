-- Migration 250 — marketing_budget_entries (dashboard v2 phase 2, HE6)
--
-- E6's entered budget figures, which nothing stored before:
--
--   season_budget  a client season budget (the plan, E6: "or a client
--                  season budget"). Client-level: event_id null.
--   credit         a credit, such as a Google promo credit. Variance is
--                  plan − paid + credits.
--   sub_budget     a sub-budget such as an afterparty: `amount` is its
--                  allocation, `spent` what ran under it (entered). The
--                  total marketing cost is paid + sub-budgets + D2C.
--   sms_cost       SMS distribution cost (E5: "SMS: entered"). Part of D2C.
--
-- Why not additional_spend_entries (044, 053): its category enum is
-- PR / INFLUENCER / PRINT / RADIO / OTHER, it needs an event, and every
-- existing reader (the client dashboard's total marketing budget, the
-- daily tracker, the portal) sums `amount` as spend. A credit or a
-- season budget written there would be added to spend on those pages.
--
-- Read by lib/dashboard/objective-budget/read.ts. Nothing writes it yet:
-- rows are entered by hand until the panel ships.
--
-- Owner access through clients.user_id (as client_reports, 196); the
-- share surfaces read with the service role.
--
-- Apply by hand from main. Idempotent.

create table if not exists marketing_budget_entries (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete cascade,
  event_id    uuid references events (id) on delete cascade,
  kind        text not null,
  label       text not null default '',
  amount      numeric(12, 2) not null,
  spent       numeric(12, 2),
  entry_date  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint marketing_budget_entries_kind_check check (
    kind in ('season_budget', 'credit', 'sub_budget', 'sms_cost')
  ),
  constraint marketing_budget_entries_amount_check check (amount >= 0),
  constraint marketing_budget_entries_spent_check check (
    spent is null or (kind = 'sub_budget' and spent >= 0)
  ),
  constraint marketing_budget_entries_season_scope_check check (
    kind <> 'season_budget' or event_id is null
  )
);

comment on table marketing_budget_entries is
  'E6 entered budget figures: client season budgets, credits, sub-budgets (allocation + spent) and SMS cost. event_id null = client level. Migration 250.';
comment on column marketing_budget_entries.amount is
  'Pounds. season_budget: the plan. credit: the credit, positive. sub_budget: the allocation. sms_cost: the cost.';
comment on column marketing_budget_entries.spent is
  'sub_budget only: what ran under it, entered. Null = not entered.';
comment on column marketing_budget_entries.entry_date is
  'The day the figure applies from (a credit''s or cost''s date, a season''s start). Reads to a day include rows on or before it, and undated rows.';

create index if not exists marketing_budget_entries_client_idx
  on marketing_budget_entries (client_id, kind);
create index if not exists marketing_budget_entries_event_idx
  on marketing_budget_entries (event_id)
  where event_id is not null;

alter table marketing_budget_entries enable row level security;

drop policy if exists "Owners manage marketing budget entries" on marketing_budget_entries;
create policy "Owners manage marketing budget entries"
  on marketing_budget_entries
  for all
  using (
    exists (
      select 1 from clients c
      where c.id = marketing_budget_entries.client_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from clients c
      where c.id = marketing_budget_entries.client_id
        and c.user_id = auth.uid()
    )
  );

drop trigger if exists marketing_budget_entries_updated_at on marketing_budget_entries;
create trigger marketing_budget_entries_updated_at
  before update on marketing_budget_entries
  for each row execute procedure update_updated_at_column();

notify pgrst, 'reload schema';
