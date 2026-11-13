-- Migration 238 — the reference-lift library (dashboard v2, D10, HD3)
--
-- docs/design-record/2026-11-13-dashboard-v2.html, D10: one library per
-- client, holding its finished shows that have counts at D−21, D−7 and a
-- final count. Each lift is stored with its evidence: the show, its date,
-- the three counts used, the comps excluded, the lift and when it was
-- computed. It is never recomputed silently: a row, once written, is not
-- updated. A new final count (a different day or figure) writes a new row
-- and the old one stays for audit; the dashboard reads the latest.
--
-- Written by the internal dashboard load (lib/dashboard/sales-calc/
-- library-store.ts), insert-only, on the owner's own session. The share
-- route reads it with the service role, scoped to the token's client, and
-- never writes.
--
-- Until this is applied the dashboard computes the entries in memory and
-- stores nothing.
--
-- Write only. Not applied from this branch. Ops applies from main.

create table if not exists public.reference_lift_library (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  client_id           uuid not null references public.clients (id) on delete cascade,
  event_id            uuid not null references public.events (id) on delete cascade,
  event_code          text not null,
  show_date           date not null,
  d21_day             date not null,
  d21_sold            numeric(12,4) not null,
  d7_day              date not null,
  d7_sold             numeric(12,4) not null,
  final_day           date not null,
  final_paid          integer not null,
  comps_excluded      integer not null default 0 check (comps_excluded >= 0),
  per_day_before      numeric(12,6) not null check (per_day_before > 0),
  per_day_final_week  numeric(12,6) not null,
  lift                numeric(12,6) not null check (lift >= 1),
  final_block_id      uuid references public.internal_count_blocks (id) on delete set null,
  computed_at         timestamptz not null default now(),
  constraint reference_lift_library_one_per_final unique (event_id, final_day, final_paid)
);

comment on table public.reference_lift_library is
  'D10 reference-lift library: one row per finished show and final count, with the evidence the lift was computed from. Insert-only; a new final count is a new row (migration 238).';
comment on column public.reference_lift_library.lift is
  'Tickets a day over the final 7 days ÷ tickets a day over the 14 days before, counts interpolated to D−21 and D−7, paid only, floored at 1.';
comment on column public.reference_lift_library.comps_excluded is
  'Comps on the final count, left out of the final figure (paid only, D8).';

create index if not exists reference_lift_library_client
  on public.reference_lift_library (client_id, show_date);

alter table public.reference_lift_library enable row level security;

drop policy if exists reference_lift_library_select_own on public.reference_lift_library;
create policy reference_lift_library_select_own on public.reference_lift_library
  for select to authenticated using (user_id = auth.uid());

drop policy if exists reference_lift_library_insert_own on public.reference_lift_library;
create policy reference_lift_library_insert_own on public.reference_lift_library
  for insert to authenticated with check (
    user_id = auth.uid()
    and event_id in (select id from public.events where user_id = auth.uid())
  );

-- No update or delete policy: an entry is never changed after it is written.
