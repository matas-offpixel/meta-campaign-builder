-- Migration 234 — Internal Counts ingest (HD1)
--
-- docs/design-record/2026-11-13-dashboard-v2.html (D8, HD1), as re-ruled by
-- docs/design-record/2026-11-13-internal-counts-matching.html (M1–M5, R1).
-- Electric's emailed "Internal Counts" PDFs become ticket truth:
--
--   internal_count_reports       one row per email read (a count, a reply in
--                                a count's thread, or a near miss) or
--                                uploaded PDF. gmail_message_id is UNIQUE, so
--                                reading a message twice writes nothing.
--   internal_count_blocks        one row per show block in a count's PDF.
--   internal_count_review_items  the review list (R1), with who checked each
--                                item and when. Nothing resolves itself.
--   internal_count_show_names    Matas's decisions on sheet names: matched to
--                                an event, or "Not a show we run". Temporary
--                                until HD2's count aliases (D9).
--
-- Gmail is read with the Drive service account through Workspace domain-wide
-- delegation (gmail.readonly, subject GMAIL_INGEST_MAILBOX), so no token is
-- stored here.
--
-- ticket_sales_snapshots gains the source 'internal_counts' (second in
-- priority: manual > internal_counts > xlsx_import > fourthefans >
-- eventbrite, in lib/db/event-history-collapse.ts). A written block also
-- upserts its paid (tier, outlet) cells into tier_channel_sales, with the
-- count date as snapshot_at. Comps, guest list and unused (−£1.00) tiers
-- stay in internal_count_blocks.parsed and never count as sold.
--
-- Write only. Not applied from this branch. Ops applies from main.
-- 233 is the migration this follows.

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
  'Provenance of this snapshot row. eventbrite = Eventbrite API. fourthefans = native 4thefans booking API. manual = operator-entered cumulative tickets. xlsx_import = weekly catch-up from an operator upload. foursomething = legacy/internal 4theFans source. internal_counts = the promoter''s emailed Internal Counts PDF (paid tickets only; a later email for the same count date replaces the row; migration 234).';

-- ── Reports ──────────────────────────────────────────────────────────────

create table if not exists public.internal_count_reports (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  gmail_message_id  text not null unique,
  gmail_thread_id   text,
  kind              text not null check (kind in ('count', 'reply', 'near_miss')),
  parent_report_id  uuid references public.internal_count_reports (id) on delete set null,
  source            text not null check (source in ('gmail', 'upload')),
  received_at       timestamptz not null,
  sender            text,
  subject           text not null,
  body_text         text not null default '',
  subject_date      date,
  sheet_date        date,
  pdf_filename      text,
  pdf_sha256        text,
  storage_path      text,
  status            text not null check (status in ('processed', 'unreadable', 'note', 'not_read')),
  created_at        timestamptz not null default now()
);

comment on table public.internal_count_reports is
  'One email read by the Internal Counts ingest, or one uploaded PDF (upload:{sha256}). kind count = matched M1; reply = a reply in a count''s thread, stored as a note on that count (parent_report_id), its text run through M3; near_miss = from the domain with a PDF and "count" in the subject, not read unless Matas says so. gmail_message_id is UNIQUE. Migration 234.';
comment on column public.internal_count_reports.sheet_date is
  'The count date most of the PDF''s blocks carry (TIER TOTALS row, day first).';
comment on column public.internal_count_reports.storage_path is
  'The PDF in the private internal-counts bucket, so a held sheet or a near miss can be read later from the same bytes.';

create index if not exists internal_count_reports_received_idx
  on public.internal_count_reports (received_at desc);
create index if not exists internal_count_reports_thread_idx
  on public.internal_count_reports (gmail_thread_id) where kind = 'count';

alter table public.internal_count_reports enable row level security;

drop policy if exists internal_count_reports_owner_select on public.internal_count_reports;
create policy internal_count_reports_owner_select on public.internal_count_reports
  for select to authenticated using (user_id = auth.uid());

-- ── Blocks ───────────────────────────────────────────────────────────────

create table if not exists public.internal_count_blocks (
  id                    uuid primary key default gen_random_uuid(),
  report_id             uuid not null references public.internal_count_reports (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  block_index           integer not null check (block_index >= 0),
  show_name             text not null,
  event_id              uuid references public.events (id) on delete set null,
  count_date            date,
  paid_tickets          integer,
  comp_tickets          integer,
  total_tickets         integer,
  since_last_count      integer,
  our_delta             integer,
  chosen_total          integer,
  paid_revenue_pence    bigint,
  revenue_held          boolean not null default false,
  revenue_released_by   uuid references auth.users (id) on delete set null,
  revenue_released_at   timestamptz,
  parsed                jsonb not null,
  status                text not null check (status in ('written', 'held', 'repeat', 'not_ours', 'replaced')),
  written_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (report_id, block_index)
);

comment on table public.internal_count_blocks is
  'One show block of an Internal Counts PDF. written = its rows are in tier_channel_sales and ticket_sales_snapshots; held = stored here only, until its review item is resolved; repeat = restates a stored count (same show, date and total); not_ours = a name marked "Not a show we run"; replaced = a later email for the same count date replaced it (both kept). Migration 234.';
comment on column public.internal_count_blocks.parsed is
  'The block as parsed: tiers (position, name, price, comp), outlet rows with null for a blank cell and 0 for a printed 0, the totals row and the TIER TOTALS row.';
comment on column public.internal_count_blocks.paid_revenue_pence is
  'The sheet''s £ for paid tiers. Read only when revenue_held is false: a price that looks wrong holds it until "Revenue is right" releases it (revenue_released_by/at). Releasing never touches a count row.';
comment on column public.internal_count_blocks.chosen_total is
  'The total Matas picked on "tiers add to n, the sheet''s total says m" (R1). Null until then.';
comment on column public.internal_count_blocks.since_last_count is
  'Their SINCE LAST COUNT, as printed. our_delta is our own difference from the previous stored count.';

create unique index if not exists internal_count_blocks_event_day_written_idx
  on public.internal_count_blocks (event_id, count_date)
  where status = 'written';

create index if not exists internal_count_blocks_event_idx
  on public.internal_count_blocks (event_id, count_date desc);
create index if not exists internal_count_blocks_held_name_idx
  on public.internal_count_blocks (show_name) where status = 'held';

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
                      'price_looks_wrong', 'sale_mention', 'unmatched_show', 'date_mismatch',
                      'sum_mismatch', 'unreadable_pdf', 'near_miss', 'replaced', 'since_last_mismatch')),
  holding           boolean not null,
  show_name         text,
  detail            jsonb not null default '{}',
  resolution        text,
  resolution_detail jsonb not null default '{}',
  resolved_by       uuid references auth.users (id) on delete set null,
  resolved_by_name  text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  check ((resolved_at is null) = (resolution is null))
);

comment on table public.internal_count_review_items is
  'The Internal Counts review list (R1). holding = the item holds counts until resolved. Only a person resolves an item: resolution, resolved_by and resolved_at are set together, and the item moves to "Checked". Migration 234.';

create index if not exists internal_count_review_items_open_idx
  on public.internal_count_review_items (user_id, created_at desc)
  where resolved_at is null;

alter table public.internal_count_review_items enable row level security;

drop policy if exists internal_count_review_items_owner_select on public.internal_count_review_items;
create policy internal_count_review_items_owner_select on public.internal_count_review_items
  for select to authenticated using (user_id = auth.uid());

-- ── Sheet-name decisions (temporary, until HD2's count aliases) ─────────

create table if not exists public.internal_count_show_names (
  name              text primary key,
  event_id          uuid references public.events (id) on delete cascade,
  not_ours          boolean not null default false,
  decided_by        uuid references auth.users (id) on delete set null,
  decided_by_name   text,
  decided_at        timestamptz not null default now(),
  check ((event_id is not null) <> not_ours)
);

comment on table public.internal_count_show_names is
  'A sheet name exactly as written → the event Matas matched it to, or "Not a show we run" (never asked again). Read beside lib/internal-counts/aliases.ts until HD2 stores count aliases on the event. Service role only. Migration 234.';

alter table public.internal_count_show_names enable row level security;

-- ── Writing one block, in one transaction ────────────────────────────────
-- p_cells: [{ "outlet": "SKIDDLE", "tier_name": "4:Final", "tickets": 12,
--             "revenue_pence": 30600 | null }]  (paid, non-blank cells only)
-- p_snapshot: { "tickets_sold": 932, "gross_revenue_cents": 1790000 | null,
--               "raw_payload": {…} }
-- A later count date never loses to an earlier one in tier_channel_sales,
-- whatever order the emails are read in. For the same count date the call
-- replaces: the block written before for (event, date) becomes 'replaced',
-- and the snapshot row for that date takes this block's figures.

create or replace function public.write_internal_count_block(
  p_block_id   uuid,
  p_event_id   uuid,
  p_client_id  uuid,
  p_user_id    uuid,
  p_count_date date,
  p_cells      jsonb,
  p_snapshot   jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_at timestamptz := (p_count_date::text || 'T12:00:00Z')::timestamptz;
begin
  update public.internal_count_blocks
     set status = 'replaced', updated_at = now()
   where event_id = p_event_id
     and count_date = p_count_date
     and status = 'written'
     and id <> p_block_id;

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
              then 'Internal Counts: revenue held'
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
  on conflict (event_id, snapshot_at, source) do update
    set tickets_sold        = excluded.tickets_sold,
        gross_revenue_cents = excluded.gross_revenue_cents,
        raw_payload         = excluded.raw_payload;

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
