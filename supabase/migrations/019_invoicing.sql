-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 019 — Invoicing & quotes.
--
-- New tables (owner-scoped via RLS, same pattern as migrations 016/017):
--   - quotes              one row per fee proposal. Capacity + service tier
--                         drive a calculated base_fee + sell_out_bonus + max_fee
--                         that survive even if pricing rules later change.
--   - invoices            generated from an approved quote (typically 2:
--                         upfront + settlement; +1 sell-out-bonus row when
--                         the quote opted in). amount_incl_vat is a stored
--                         generated column so callers never have to derive it.
--                         invoice_number is nullable, manually entered by
--                         the user post-creation (no auto-sequencing).
--
-- Quote status lifecycle:
--   draft → approved → converted (event created) | cancelled
-- Invoice status lifecycle:
--   draft → sent → paid | overdue | cancelled
--
-- Schema additions to existing tables:
--   - clients.default_upfront_pct        - per-client default for new quotes
--   - clients.default_settlement_timing  - same
--
-- After applying:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt \
--     > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Quotes table ───────────────────────────────────────────────────────────

create table if not exists quotes (
  id                  uuid          primary key default gen_random_uuid(),
  user_id             uuid          not null references auth.users (id) on delete cascade,
  client_id           uuid          not null references clients     (id) on delete cascade,
  event_id            uuid          references events             (id) on delete set null,
  quote_number        text          not null,

  -- Event info captured at quote time. Mirrors the canonical event row shape
  -- so the quote stays standalone before the event is created.
  event_name          text          not null,
  event_date          date,
  announcement_date   date,
  venue_name          text,
  venue_city          text,
  venue_country       text,

  -- Inputs
  capacity            integer       not null,
  marketing_budget    numeric(10,2),
  service_tier        text          not null
    check (service_tier in ('ads', 'ads_d2c', 'ads_d2c_creative')),
  sold_out_expected   boolean       not null default false,

  -- Calculated outputs (frozen — pricing changes later don't rewrite them).
  base_fee            numeric(10,2) not null,
  sell_out_bonus     numeric(10,2) not null default 0,
  max_fee             numeric(10,2) not null,

  -- Payment terms snapshot (copied from clients.default_* at create time).
  upfront_pct         numeric(5,2)  not null default 75,
  settlement_timing   text          not null default '1_month_before'
    check (settlement_timing in (
      '1_month_before', '2_weeks_before', 'on_completion'
    )),

  -- Billing-mode snapshot. Mirrors clients.billing_model at create time so
  -- changing a client over to retainer doesn't retroactively rewrite the
  -- shape of historical per-event quotes.
  billing_mode        text          not null default 'per_event'
    check (billing_mode in ('per_event', 'retainer')),
  retainer_months     integer,

  status              text          not null default 'draft'
    check (status in ('draft', 'approved', 'converted', 'cancelled')),

  approved_at         timestamptz,
  converted_at        timestamptz,
  notes               text,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),

  constraint quotes_quote_number_user_unique unique (user_id, quote_number)
);

create index if not exists quotes_user_id_idx     on quotes (user_id);
create index if not exists quotes_client_id_idx   on quotes (client_id);
create index if not exists quotes_event_id_idx    on quotes (event_id);
create index if not exists quotes_status_idx      on quotes (status);
create index if not exists quotes_created_at_idx  on quotes (created_at desc);

comment on table  quotes is
  'Fee proposals authored before an event exists. base_fee / sell_out_bonus / max_fee are frozen at create time so pricing rule changes do not retroactively rewrite history. Approved quotes spawn invoices; converted quotes link to the event they spawned.';
comment on column quotes.quote_number is
  'Workspace-scoped human readable id (e.g. QUO-0001) computed at insert time by scanning max(quote_number) per user_id. Unique per user.';
comment on column quotes.upfront_pct is
  'Snapshot of clients.default_upfront_pct at create time. Lets the client default change without rewriting historical quotes.';
comment on column quotes.settlement_timing is
  'When the settlement invoice falls due relative to the event date. Snapshot, same rationale as upfront_pct.';

alter table quotes enable row level security;

drop policy if exists quotes_owner_select on quotes;
create policy quotes_owner_select on quotes
  for select using (auth.uid() = user_id);

drop policy if exists quotes_owner_insert on quotes;
create policy quotes_owner_insert on quotes
  for insert with check (auth.uid() = user_id);

drop policy if exists quotes_owner_update on quotes;
create policy quotes_owner_update on quotes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists quotes_owner_delete on quotes;
create policy quotes_owner_delete on quotes
  for delete using (auth.uid() = user_id);


-- ── Invoices table ─────────────────────────────────────────────────────────

create table if not exists invoices (
  id                  uuid          primary key default gen_random_uuid(),
  user_id             uuid          not null references auth.users (id) on delete cascade,
  client_id           uuid          not null references clients     (id) on delete cascade,
  event_id            uuid          references events             (id) on delete set null,
  quote_id            uuid          references quotes             (id) on delete set null,

  -- invoice_number is nullable + entered manually by the user.
  -- Unique-when-set so two invoices can share NULL but a typed-in
  -- INV-0029 still collides cleanly across the workspace.
  invoice_number      text,
  invoice_type        text          not null
    check (invoice_type in ('upfront', 'settlement', 'sell_out_bonus', 'other', 'retainer')),

  amount_excl_vat     numeric(10,2) not null,
  vat_applicable      boolean       not null default true,
  vat_rate            numeric(5,4)  not null default 0.2000,
  amount_incl_vat     numeric(10,2) generated always as (
    case when vat_applicable
      then round(amount_excl_vat * (1 + vat_rate), 2)
      else amount_excl_vat
    end
  ) stored,

  issued_date         date,
  due_date            date,
  paid_date           date,

  status              text          not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'overdue', 'cancelled')),

  notes               text,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

create index if not exists invoices_user_id_idx       on invoices (user_id);
create index if not exists invoices_client_id_idx     on invoices (client_id);
create index if not exists invoices_event_id_idx      on invoices (event_id);
create index if not exists invoices_quote_id_idx      on invoices (quote_id);
create index if not exists invoices_status_idx        on invoices (status);
create index if not exists invoices_due_date_idx      on invoices (due_date);

-- Unique-when-set: NULLs allowed (multiple invoices can be unnumbered)
-- but a typed-in INV-0029 still collides per workspace.
create unique index if not exists invoices_invoice_number_user_unique
  on invoices (user_id, invoice_number)
  where invoice_number is not null;

comment on table  invoices is
  'Concrete billable line items. Each approved quote creates one upfront row, one settlement row, and (when sold_out_expected was true) one sell_out_bonus row. Retainer-mode quotes create one row per month invoiced.';
comment on column invoices.amount_incl_vat is
  'Stored generated column = round(amount_excl_vat * (1 + vat_rate), 2) when vat_applicable, else amount_excl_vat. Read this rather than recomputing client-side.';
comment on column invoices.invoice_number is
  'Manually entered by the user (e.g. INV-0029). Nullable at creation; uniqueness enforced per workspace via partial index.';

alter table invoices enable row level security;

drop policy if exists invoices_owner_select on invoices;
create policy invoices_owner_select on invoices
  for select using (auth.uid() = user_id);

drop policy if exists invoices_owner_insert on invoices;
create policy invoices_owner_insert on invoices
  for insert with check (auth.uid() = user_id);

drop policy if exists invoices_owner_update on invoices;
create policy invoices_owner_update on invoices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists invoices_owner_delete on invoices;
create policy invoices_owner_delete on invoices
  for delete using (auth.uid() = user_id);


-- ── Quote + invoice numbering ──────────────────────────────────────────────
--
-- Quote numbers (QUO-XXXX) are computed on the application side at insert
-- time by scanning max(quote_number) per user_id — no sequences table.
-- Invoice numbers (INV-XXXX) are manually entered by the user post-creation
-- so they can dovetail with the user's external bookkeeping run.


-- ── updated_at touch triggers ──────────────────────────────────────────────

create or replace function set_quotes_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists quotes_set_updated_at on quotes;
create trigger quotes_set_updated_at
  before update on quotes
  for each row execute function set_quotes_updated_at();

create or replace function set_invoices_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists invoices_set_updated_at on invoices;
create trigger invoices_set_updated_at
  before update on invoices
  for each row execute function set_invoices_updated_at();


-- ── Per-client payment defaults ────────────────────────────────────────────

alter table clients
  add column if not exists default_upfront_pct        numeric(5,2) default 75,
  add column if not exists default_settlement_timing  text         default '1_month_before';

-- Enforce the same enum on the client default that the quote snapshot uses.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_default_settlement_timing_check'
  ) then
    alter table clients
      add constraint clients_default_settlement_timing_check check (
        default_settlement_timing in (
          '1_month_before', '2_weeks_before', 'on_completion'
        )
      );
  end if;
end $$;

comment on column clients.default_upfront_pct is
  'Default percentage of base_fee invoiced upfront for this client. Quote builder pre-fills from here; the quote then snapshots the value.';
comment on column clients.default_settlement_timing is
  'When the settlement invoice falls due relative to the event date. Quote builder pre-fills; the quote snapshots.';

-- Known client overrides (slug-based so apply order is irrelevant):
--   Louder/Parable bills 50% upfront with the balance on completion.
--   All other clients use the table default (75% / 1 month before).
update clients
   set default_upfront_pct       = 50,
       default_settlement_timing = 'on_completion'
 where slug = 'louder-parable';


-- ── PostgREST schema cache refresh ────────────────────────────────────────

notify pgrst, 'reload schema';
