-- Migration 062 — TikTok write idempotency foundation
--
-- Foundation only. Apply manually via Cowork MCP after review.

create table if not exists tiktok_write_idempotency (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  event_id        uuid not null references events on delete cascade,
  draft_id        uuid not null references tiktok_campaign_drafts on delete cascade,
  op_kind         text not null check (op_kind in (
    'campaign_create',
    'adgroup_create',
    'ad_create',
    'creative_upload'
  )),
  op_payload_hash text not null,
  op_result_id    text,
  op_status       text not null check (op_status in ('pending', 'success', 'failed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (draft_id, op_kind, op_payload_hash)
);

create index if not exists tiktok_write_idempotency_draft_idx
  on tiktok_write_idempotency (draft_id, op_kind, created_at desc);

alter table tiktok_write_idempotency enable row level security;

drop policy if exists tiktok_write_idempotency_service_role_only
  on tiktok_write_idempotency;
create policy tiktok_write_idempotency_service_role_only
  on tiktok_write_idempotency
  for all
  using (false)
  with check (false);

create or replace function set_tiktok_write_idempotency_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.tiktok_write_idempotency'::regclass
      and tgname = 'tiktok_write_idempotency_updated_at'
  ) then
    execute
      'create trigger tiktok_write_idempotency_updated_at '
      'before update on tiktok_write_idempotency '
      'for each row execute function set_tiktok_write_idempotency_updated_at()';
  end if;
end $$;

notify pgrst, 'reload schema';
