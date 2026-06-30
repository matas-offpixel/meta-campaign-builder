-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 127 — D2C brief ingest jobs.
-- (Renumbered 125→127 on disk to match the prod ledger entry
--  `127_d2c_brief_ingest`. Prod apply is timestamp-versioned — no re-apply.)
--
-- Tracks PDF (or manual JSON) brief → structured campaign ingestion. The
-- /api/d2c/ingest-brief route inserts a row, then background processing
-- (Next.js `after()`) parses the brief and writes the event + d2c_event_copy +
-- d2c_scheduled_sends rows, finally stamping result_event_id + status.
--
-- Reversibility:
--   drop table if exists d2c_brief_ingest_jobs;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists d2c_brief_ingest_jobs (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  client_id        uuid        not null references clients (id)    on delete cascade,
  source           text        not null check (source in ('pdf', 'manual')),
  -- For pdf: a transient note / filename (we do NOT persist the PDF bytes).
  -- For manual: null or a short descriptor.
  source_uri       text,
  status           text        not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  result_event_id  uuid        references events (id) on delete set null,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table d2c_brief_ingest_jobs is
  'One row per brief ingestion attempt (PDF upload or manual JSON). Processed in the background; status walks pending → processing → succeeded|failed.';

-- Hot path: the UI polls open jobs for a user. Partial index keeps it tiny.
create index if not exists d2c_brief_ingest_jobs_open_idx
  on d2c_brief_ingest_jobs (user_id, status)
  where status in ('pending', 'processing', 'failed');

create index if not exists d2c_brief_ingest_jobs_user_created_idx
  on d2c_brief_ingest_jobs (user_id, created_at desc);

alter table d2c_brief_ingest_jobs enable row level security;

drop policy if exists d2c_brief_ingest_select on d2c_brief_ingest_jobs;
create policy d2c_brief_ingest_select on d2c_brief_ingest_jobs
  for select using (auth.uid() = user_id);
drop policy if exists d2c_brief_ingest_insert on d2c_brief_ingest_jobs;
create policy d2c_brief_ingest_insert on d2c_brief_ingest_jobs
  for insert with check (auth.uid() = user_id);
drop policy if exists d2c_brief_ingest_update on d2c_brief_ingest_jobs;
create policy d2c_brief_ingest_update on d2c_brief_ingest_jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists d2c_brief_ingest_delete on d2c_brief_ingest_jobs;
create policy d2c_brief_ingest_delete on d2c_brief_ingest_jobs
  for delete using (auth.uid() = user_id);

create or replace function set_d2c_brief_ingest_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists d2c_brief_ingest_set_updated_at on d2c_brief_ingest_jobs;
create trigger d2c_brief_ingest_set_updated_at
  before update on d2c_brief_ingest_jobs
  for each row execute function set_d2c_brief_ingest_updated_at();

notify pgrst, 'reload schema';
