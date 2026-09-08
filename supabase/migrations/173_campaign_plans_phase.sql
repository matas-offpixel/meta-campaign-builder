-- Migration 173 — campaign_plans.phase + events.sold_out_at
--
-- Settled 2026-09-08: one event → one ad_plans row → several
-- campaign_plans rows, one per phase (presale | on_sale | waiting_list).
-- campaign_plans was never a competing plan; it is a phase. Today it
-- cannot say which phase it is.
--
-- A phase is a span on campaign_plans. Do not reuse
-- ad_plan_days.phase_marker — that is a free-text annotation on a single
-- day (null on 698 of 704 rows; the six that are set read Event day,
-- Announce, Final push). Borrowing the name would collide two meanings.
--
-- events.sold_out_at is set by hand. Null (ordinary) means not sold out:
-- on_sale runs to the show and waiting_list cannot start. Do not infer
-- sell-out from a ticket count reaching a capacity — capacity claims are
-- forbidden for Boston Manor Park and Junction 2.
--
-- Backfill compares start_date to the event's UTC calendar date
-- (`(timestamptz at time zone 'utc')::date`). It does not default anyone to on_sale.
-- Rows that cannot be derived stay null.
--
-- Expected 2026-09-08 mapping (prod, eight campaign_plans rows):
--   299dd4e5-cc76-4419-a5a0-eec5896c95ef  D.O.D / NX26-DOD
--     start 2026-08-27  presale null  general 2026-09-04 13:00Z  → null
--     (start is before general sale; there is no presale span)
--   abf386e4-c234-4a41-927a-682188eed0e1  Jamie Jones / IRW0001  "Test"
--     start 2026-08-26  no sale dates  → null
--   49803b0d-e352-4115-aeb9-88de31d8b3d3  Jamie Jones / IRW0001  "Test 5"
--     start null  no sale dates  → null
--   fb059252-b3a0-47f0-970c-6e7028a69018  Mall Grab / ES26-MALLGRAB
--     start 2026-08-27  presale 2026-08-06 09:00Z  general 2026-08-07 09:00Z  → on_sale
--   cbd199a5-f30c-4457-ae33-43d5615c7e13  DJ EZ / NX26-DJEZ
--     start 2026-09-07  presale 2026-08-21 11:00Z  general 2026-08-21 13:00Z  → on_sale
--   20a94559-b03b-4c14-abf1-c0a6ac0be9a0  Folamour / NX26-FOLAMOUR
--     start 2026-09-07  presale null  general 2026-09-03 13:00Z  → on_sale
--   c565fdde-1dda-4f6b-ab88-4345c0067c59  Folamour / NX26-FOLAMOUR
--     same dates  → on_sale
--   18dab888-1aef-492c-8145-2f9c12550f9f  Folamour / NX26-FOLAMOUR
--     same dates  → on_sale
-- Schak has no campaign_plans row (and no sale dates). The "no sale dates
-- → leave null" rows are the two Jamie Jones plans, not Schak.
--
-- Apply after review. Do not apply in this run.

alter table events
  add column if not exists sold_out_at timestamptz;

comment on column events.sold_out_at is
  'Hand-set instant the show sold out. Null (ordinary) means not sold out: on_sale runs to the show and waiting_list cannot start. Do not infer from ticket counts or capacity.';

alter table campaign_plans
  add column if not exists phase text;

alter table campaign_plans
  drop constraint if exists campaign_plans_phase_check;

alter table campaign_plans
  add constraint campaign_plans_phase_check
    check (phase is null or phase in ('presale', 'on_sale', 'waiting_list'));

comment on column campaign_plans.phase is
  'presale | on_sale | waiting_list. A span on this row, not ad_plan_days.phase_marker. Null when the phase cannot be derived (no sale dates, or start_date before the first known sale boundary). Do not default to on_sale.';

-- Backfill. sold_out_at is null on every event today, so waiting_list
-- cannot match. Check it before on_sale so a later hand-set sell-out
-- date wins for rows that start on or after it.
update campaign_plans p
set phase = case
  when p.start_date is null then null
  when e.presale_at is not null
       and e.general_sale_at is not null
       and p.start_date >= (e.presale_at at time zone 'utc')::date
       and p.start_date <  (e.general_sale_at at time zone 'utc')::date
    then 'presale'
  when e.sold_out_at is not null
       and p.start_date >= (e.sold_out_at at time zone 'utc')::date
    then 'waiting_list'
  when e.general_sale_at is not null
       and p.start_date >= (e.general_sale_at at time zone 'utc')::date
    then 'on_sale'
  else null
end
from events e
where e.id = p.event_id
  and p.phase is null;

notify pgrst, 'reload schema';
