-- Migration 234 — Internal Counts ingest (HD1)
--
-- docs/design-record/2026-11-13-dashboard-v2.html, D8 and HD1.
-- Electric's emailed "Internal Counts" PDFs become ticket truth:
--
--   internal_count_reports       one row per email (or uploaded PDF), unique
--                                on the Gmail message id, so reading a
--                                message twice writes nothing.
--   internal_count_blocks        one row per show block in the PDF: the parse,
--                                the totals, their SINCE LAST COUNT, and
--                                whether it was written.
--   internal_count_review_items  the review list: anything unmatched, any
--                                failed check, and the notes beside a count.
--   gmail_connections            the connected inbox (no secret here)
--   gmail_connection_secrets     its refresh token, pgcrypto-encrypted with
--                                GMAIL_TOKEN_KEY (a dedicated key, never
--                                reused). Service role only.
--
-- ticket_sales_snapshots gains the source 'internal_counts' (second in
-- priority: manual > internal_counts > xlsx_import > fourthefans >
-- eventbrite, in lib/db/event-history-collapse.ts).
--
-- A written block also upserts its paid (tier, outlet) cells into
-- tier_channel_sales, which keeps one running total per (event, tier,
-- outlet) with the count date as snapshot_at. Comps and guest list stay in
-- internal_count_blocks.parsed, flagged, and never count as sold.
--
-- Write only. Not applied from this branch. Ops applies from main.
-- 233 is the migration this follows.

create extension if not exists pgcrypto;

-- ── ticket_sales_snapshots.source ────────────────────────────────────────

alter table public.ticket_sales_snapshots
  drop constraint if exists ticket_sales_snapshots_source_check;

alter table public.ticket_sales_snapshots
  add constraint ticket_sales_snapshots_source_check
  check (
    source in (
      'eventbrite',
      'fourthefans',
      'manual',
      'xlsx_import',
      'foursomething',
      'internal_counts'
    )
  );

comment on column public.ticket_sales_snapshots.source is
  'Provenance of this snapshot row. eventbrite = Eventbrite API. fourthefans = native 4thefans booking API. manual = operator-entered cumulative tickets. xlsx_import = weekly catch-up from an operator upload. foursomething = legacy/internal 4theFans source. internal_counts = the promoter''s emailed Internal Counts PDF (paid tickets only; migration 234). NEVER mutated after insert.';

-- ── Gmail connection ─────────────────────────────────────────────────────

create table if not exists public.gmail_connections (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references auth.users (id) on delete cascade,
  email            text not null,
  scope            text not null,
  connected_at     timestamptz not null default now(),
  last_pull_at     timestamptz,
  last_pull_error  text,
  updated_at       timestamptz not null default now()
);

comment on table public.gmail_connections is
  'The inbox the Internal Counts pull reads (gmail.readonly). One per operator. The refresh token is in gmail_connection_secrets. Migration 234.';

alter table public.gmail_connections enable row level security;

drop policy if exists gmail_connections_owner_select on public.gmail_connections;
create policy gmail_connections_owner_select on public.gmail_connections
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.gmail_connection_secrets (
  connection_id            uuid primary key references public.gmail_connections (id) on delete cascade,
  refresh_token_encrypted  bytea not null,
  updated_at               timestamptz not null default now()
);

comment on table public.gmail_connection_secrets is
  'pgp_sym_encrypt(refresh_token, GMAIL_TOKEN_KEY). RLS on with no policies: service role only, through set_/get_gmail_refresh_token. Migration 234.';

alter table public.gmail_connection_secrets enable row level security;

create or replace function public.set_gmail_refresh_token(
  p_connection_id uuid,
  p_refresh_token text,
  p_key           text
)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  if p_refresh_token is null or length(p_refresh_token) = 0 then
    raise exception 'refresh token is required';
  end if;
  if p_key is null or length(p_key) < 16 then
    raise exception 'GMAIL_TOKEN_KEY must be set and at least 16 characters';
  end if;
  insert into public.gmail_connection_secrets (connection_id, refresh_token_encrypted, updated_at)
  values (p_connection_id, pgp_sym_encrypt(p_refresh_token, p_key), now())
  on conflict (connection_id) do update
    set refresh_token_encrypted = excluded.refresh_token_encrypted,
        updated_at = now();
end;
$$;

create or replace function public.get_gmail_refresh_token(
  p_connection_id uuid,
  p_key           text
)
returns text
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_blob bytea;
begin
  if p_key is null or length(p_key) < 16 then
    raise exception 'GMAIL_TOKEN_KEY must be set and at least 16 characters';
  end if;
  select refresh_token_encrypted into v_blob
    from public.gmail_connection_secrets
   where connection_id = p_connection_id;
  if v_blob is null then
    return null;
  end if;
  return pgp_sym_decrypt(v_blob, p_key)::text;
end;
$$;

revoke all on function public.set_gmail_refresh_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_gmail_refresh_token(uuid, text) from public, anon, authenticated;
grant execute on function public.set_gmail_refresh_token(uuid, text, text) to service_role;
grant execute on function public.get_gmail_refresh_token(uuid, text) to service_role;

-- ── Reports ──────────────────────────────────────────────────────────────

create table if not exists public.internal_count_reports (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  gmail_message_id  text not null unique,
  source            text not null check (source in ('gmail', 'upload')),
  received_at       timestamptz not null,
  sender            text,
  subject           text not null,
  body_text         text not null default '',
  subject_date      date,
  count_date        date,
  pdf_filename      text,
  pdf_sha256        text,
  storage_path      text,
  status            text not null check (status in ('processed', 'unreadable')),
  created_at        timestamptz not null default now()
);

comment on table public.internal_count_reports is
  'One Internal Counts email, or one uploaded PDF. gmail_message_id is UNIQUE: the same email read twice writes nothing. An upload uses upload:{pdf sha256}. A corrected email the next day is a new report, never an overwrite. Migration 234.';
comment on column public.internal_count_reports.body_text is
  'The email body, stored with the count. A body that mentions sales adds a review item; it is never parsed into counts.';
comment on column public.internal_count_reports.count_date is
  'The count date most blocks in the PDF carry (from their TIER TOTALS row).';
comment on column public.internal_count_reports.storage_path is
  'Path of the PDF in the private internal-counts bucket, kept so a review-list rerun parses the same bytes.';

create index if not exists internal_count_reports_received_idx
  on public.internal_count_reports (received_at desc);

alter table public.internal_count_reports enable row level security;

drop policy if exists internal_count_reports_owner_select on public.internal_count_reports;
create policy internal_count_reports_owner_select on public.internal_count_reports
  for select to authenticated using (user_id = auth.uid());

-- ── Blocks ───────────────────────────────────────────────────────────────

create table if not exists public.internal_count_blocks (
  id                   uuid primary key default gen_random_uuid(),
  report_id            uuid not null references public.internal_count_reports (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  block_index          integer not null check (block_index >= 0),
  show_name            text not null,
  event_id             uuid references public.events (id) on delete set null,
  proposed_event_code  text,
  count_date           date,
  paid_tickets         integer,
  comp_tickets         integer,
  total_tickets        integer,
  since_last_count     integer,
  our_delta            integer,
  revenue_withheld     boolean not null default false,
  paid_revenue_pence   bigint,
  parsed               jsonb not null,
  status               text not null check (status in ('written', 'review', 'repeat')),
  written_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (report_id, block_index)
);

comment on table public.internal_count_blocks is
  'One show block of an Internal Counts PDF. status written = every row it implies is in tier_channel_sales and ticket_sales_snapshots; review = nothing written; repeat = the block restates a count already stored (same show, date and total; a finished show stays on the sheet) and writes nothing. Nothing is half-written. Migration 234.';
comment on column public.internal_count_blocks.parsed is
  'The block as parsed: tiers (position, name, price, unused, comp), outlet rows with a null for a blank cell and 0 for a printed 0, the totals row and the TIER TOTALS row.';
comment on column public.internal_count_blocks.since_last_count is
  'Their SINCE LAST COUNT, as printed. our_delta is our own difference from the previous stored count; a mismatch is a review item, not a block.';
comment on column public.internal_count_blocks.paid_revenue_pence is
  'Paid tiers'' £ in pence. Null when revenue is withheld (a price that looks wrong) or the block did not pass its checks.';

create unique index if not exists internal_count_blocks_event_day_written_idx
  on public.internal_count_blocks (event_id, count_date)
  where status = 'written';

create index if not exists internal_count_blocks_event_idx
  on public.internal_count_blocks (event_id, count_date desc);

alter table public.internal_count_blocks enable row level security;

drop policy if exists internal_count_blocks_owner_select on public.internal_count_blocks;
create policy internal_count_blocks_owner_select on public.internal_count_blocks
  for select to authenticated using (user_id = auth.uid());

-- ── Review items ─────────────────────────────────────────────────────────

create table if not exists public.internal_count_review_items (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references public.internal_count_reports (id) on delete cascade,
  block_id          uuid references public.internal_count_blocks (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  kind              text not null check (kind in (
                      'unreadable_pdf', 'check_failed', 'unmatched_show', 'unknown_event',
                      'umbrella', 'duplicate_count_date', 'price_looks_wrong',
                      'count_date_mismatch', 'since_last_mismatch', 'body_mentions_sales')),
  blocking          boolean not null,
  show_name         text,
  message           text not null,
  detail            jsonb not null default '{}',
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

comment on table public.internal_count_review_items is
  'The Internal Counts review list. blocking = the block wrote nothing because of it. A rerun after an alias is confirmed resolves the blocking items it clears. Migration 234.';

create index if not exists internal_count_review_items_open_idx
  on public.internal_count_review_items (user_id, created_at desc)
  where resolved_at is null;

alter table public.internal_count_review_items enable row level security;

drop policy if exists internal_count_review_items_owner_select on public.internal_count_review_items;
create policy internal_count_review_items_owner_select on public.internal_count_review_items
  for select to authenticated using (user_id = auth.uid());

-- ── Writing one block, in one transaction ────────────────────────────────
-- p_cells: [{ "outlet": "SKIDDLE", "tier_name": "4:Final", "tickets": 12,
--             "revenue_pence": 30600 | null }]  (paid, non-blank cells only)
-- p_snapshot: { "tickets_sold": 932, "gross_revenue_cents": 1790000 | null,
--               "raw_payload": {…} }
-- A later count date never loses to an earlier one in tier_channel_sales,
-- whatever order the emails are read in. The snapshot row is keyed on
-- (event_id, snapshot_at, source), so a rerun writes nothing new.

create or replace function public.write_internal_count_block(
  p_block_id  uuid,
  p_event_id  uuid,
  p_client_id uuid,
  p_user_id   uuid,
  p_count_date date,
  p_cells     jsonb,
  p_snapshot  jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_at timestamptz := (p_count_date::text || 'T12:00:00Z')::timestamptz;
begin
  insert into public.tier_channels (client_id, channel_name, display_label, is_automatic)
  select distinct p_client_id, c->>'outlet', c->>'outlet', true
    from jsonb_array_elements(p_cells) c
  on conflict (client_id, channel_name) do nothing;

  insert into public.tier_channel_sales
    (event_id, tier_name, channel_id, tickets_sold, revenue_amount, revenue_overridden, notes, snapshot_at, updated_at)
  select p_event_id,
         c->>'tier_name',
         ch.id,
         (c->>'tickets')::integer,
         coalesce((c->>'revenue_pence')::numeric / 100, 0),
         (c->>'revenue_pence') is null,
         case when (c->>'revenue_pence') is null
              then 'Internal Counts: revenue withheld (price looks wrong)'
              else 'Internal Counts' end,
         v_at,
         now()
    from jsonb_array_elements(p_cells) c
    join public.tier_channels ch
      on ch.client_id = p_client_id and ch.channel_name = c->>'outlet'
  on conflict (event_id, tier_name, channel_id) do update
    set tickets_sold       = excluded.tickets_sold,
        revenue_amount     = excluded.revenue_amount,
        revenue_overridden = excluded.revenue_overridden,
        notes              = excluded.notes,
        snapshot_at        = excluded.snapshot_at,
        updated_at         = now()
    where public.tier_channel_sales.snapshot_at <= excluded.snapshot_at;

  insert into public.ticket_sales_snapshots
    (user_id, event_id, connection_id, snapshot_at, tickets_sold, gross_revenue_cents, currency, raw_payload, source)
  values (
    p_user_id, p_event_id, null, v_at,
    (p_snapshot->>'tickets_sold')::integer,
    (p_snapshot->>'gross_revenue_cents')::bigint,
    'GBP',
    p_snapshot->'raw_payload',
    'internal_counts'
  )
  on conflict (event_id, snapshot_at, source) do nothing;

  update public.internal_count_blocks
     set status = 'written', written_at = now(), updated_at = now()
   where id = p_block_id;
end;
$$;

revoke all on function public.write_internal_count_block(uuid, uuid, uuid, uuid, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_internal_count_block(uuid, uuid, uuid, uuid, date, jsonb, jsonb) to service_role;

-- ── PDF storage ──────────────────────────────────────────────────────────
-- Private. The service role writes and reads; nobody else can.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('internal-counts', 'internal-counts', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
