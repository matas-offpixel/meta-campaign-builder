-- Migration 156 — Meta write idempotency ledger
--
-- Mirrors tiktok_write_idempotency (062): draft-scoped keys, cleared on
-- rollback. Apply manually after review. The Meta launch path reads this
-- table additively — if it is absent at runtime the launcher behaves
-- exactly as today (no hard dependency).
--
-- Foundation only. Do not apply as part of the Phase D unattended run.

create table if not exists meta_write_idempotency (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  event_id        uuid references events on delete cascade,
  draft_id        uuid not null references campaign_drafts on delete cascade,
  op_kind         text not null check (op_kind in (
    'campaign_create',
    'adset_create',
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

create index if not exists meta_write_idempotency_draft_idx
  on meta_write_idempotency (draft_id, op_kind, created_at desc);

alter table meta_write_idempotency enable row level security;

drop policy if exists meta_write_idempotency_service_role_only
  on meta_write_idempotency;
create policy meta_write_idempotency_service_role_only
  on meta_write_idempotency
  for all
  using (false)
  with check (false);

create or replace function set_meta_write_idempotency_updated_at()
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
    where tgrelid = 'public.meta_write_idempotency'::regclass
      and tgname = 'meta_write_idempotency_updated_at'
  ) then
    execute
      'create trigger meta_write_idempotency_updated_at '
      'before update on meta_write_idempotency '
      'for each row execute function set_meta_write_idempotency_updated_at()';
  end if;
end $$;

notify pgrst, 'reload schema';
