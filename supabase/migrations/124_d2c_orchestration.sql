-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 124 — D2C orchestration: per-send job typing + idempotency + the
-- per-event rendered-copy snapshot table.
--
-- Context: migration 042 already landed credential encryption + the
-- live_enabled / approved_by_matas / approval_status gates. This migration adds
-- the pieces the brief→campaign automation needs on top of that:
--
--   1. d2c_scheduled_sends.job_type        — which milestone a send represents.
--   2. d2c_scheduled_sends.idempotency_key — `${event_id}:${job_type}` so the
--      brief processor can re-run without creating duplicate sends.
--   3. d2c_event_copy                       — one row per event holding the
--      rendered copy bundle (keyed by job_type), the resolved artwork URL, and
--      the single human runtime input (WhatsApp community URL).
--
-- Reversibility:
--   drop table if exists d2c_event_copy;
--   alter table d2c_scheduled_sends
--     drop column if exists job_type,
--     drop column if exists idempotency_key;
-- (No data migration; all columns are additive + nullable.)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── d2c_scheduled_sends: job_type + idempotency_key ─────────────────────────

alter table d2c_scheduled_sends
  add column if not exists job_type text
    check (job_type is null or job_type in (
      'announce', 'reminder', 'community_early',
      'presale_live', 'gen_sale', 'autoresp_setup'
    )),
  add column if not exists idempotency_key text;

comment on column d2c_scheduled_sends.job_type is
  'Milestone this send represents. Null for legacy/manual rows. Mirrors lib/d2c/types.ts D2CJobType.';
comment on column d2c_scheduled_sends.idempotency_key is
  'Deterministic `${event_id}:${job_type}` so the brief processor can upsert without duplicating sends. NULL allowed for legacy/manual rows — Postgres treats NULLs as distinct, so many NULLs coexist under this unique index. A non-partial index is required so ON CONFLICT (idempotency_key) upserts can infer it.';

-- Full (non-partial) unique index: enables ON CONFLICT (idempotency_key)
-- inference while still permitting unlimited NULL rows (NULLS DISTINCT default).
create unique index if not exists d2c_scheduled_sends_idempotency_key_uidx
  on d2c_scheduled_sends (idempotency_key);

-- ── d2c_event_copy ──────────────────────────────────────────────────────────
-- Replaces the spec's `comms` table. Reuses d2c_templates as the master shape
-- (subject + body_markdown per channel) but stores the *rendered* output for a
-- single event. One row per event.

create table if not exists d2c_event_copy (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users (id) on delete cascade,
  event_id              uuid        not null references events (id)     on delete cascade,
  client_id             uuid        not null references clients (id)    on delete cascade,
  -- Resolved poster/artwork. Step 1 of lib/d2c/assets/resolver.ts reads this.
  artwork_url           text,
  -- The single human runtime input — pasted by Matas before approval.
  whatsapp_community_url text,
  -- Rendered copy bundle keyed by job_type:
  --   { announce: {subject, body_markdown}, reminder: {...}, community_early: {...},
  --     presale_live: {...}, gen_sale: {...}, autoresp_setup: {...} }
  copy_jsonb            jsonb       not null default '{}'::jsonb,
  -- Link back to the brief ingest job that produced this snapshot (migration 125).
  source_brief_job_id   uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (event_id)
);

comment on table d2c_event_copy is
  'Per-event rendered D2C copy snapshot produced by the brief parser. copy_jsonb is keyed by job_type. artwork_url + whatsapp_community_url feed the cron renderer.';

create index if not exists d2c_event_copy_event_idx
  on d2c_event_copy (event_id);
create index if not exists d2c_event_copy_user_client_idx
  on d2c_event_copy (user_id, client_id);

alter table d2c_event_copy enable row level security;

drop policy if exists d2c_event_copy_select on d2c_event_copy;
create policy d2c_event_copy_select on d2c_event_copy
  for select using (auth.uid() = user_id);
drop policy if exists d2c_event_copy_insert on d2c_event_copy;
create policy d2c_event_copy_insert on d2c_event_copy
  for insert with check (auth.uid() = user_id);
drop policy if exists d2c_event_copy_update on d2c_event_copy;
create policy d2c_event_copy_update on d2c_event_copy
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists d2c_event_copy_delete on d2c_event_copy;
create policy d2c_event_copy_delete on d2c_event_copy
  for delete using (auth.uid() = user_id);

create or replace function set_d2c_event_copy_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists d2c_event_copy_set_updated_at on d2c_event_copy;
create trigger d2c_event_copy_set_updated_at
  before update on d2c_event_copy
  for each row execute function set_d2c_event_copy_updated_at();

notify pgrst, 'reload schema';
