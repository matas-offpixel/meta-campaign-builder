-- Migration 194 — MML copy (M3)
--
-- The URL Suggest fetched, a capped extract of the page (no email
-- addresses), and the suggestions the operator ticked. Owner-only RLS,
-- same shape as 193. Apply manually after review.
-- Idempotent: if not exists + catalog-checked policies.

create table if not exists campaign_plan_copy (
  plan_id        uuid primary key references campaign_plans (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  source_url     text,
  fetch_error    text,
  page_text      text,
  suggestions    jsonb not null default '[]'::jsonb,
  selected_ids   jsonb not null default '[]'::jsonb,
  model          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint campaign_plan_copy_page_text_cap
    check (page_text is null or char_length(page_text) <= 8000)
);

comment on table campaign_plan_copy is
  'MML ③. The fetched page extract and the suggestions Apply last wrote. page_text is capped and has no email addresses.';
comment on column campaign_plan_copy.page_text is
  'Title, meta, Open Graph, JSON-LD and stripped body, capped at 8000 characters, emails removed. Used to re-check facts. Not a copy of the page.';

alter table campaign_plan_copy enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'campaign_plan_copy'
      and policyname = 'Users can manage their own campaign_plan_copy'
  ) then
    create policy "Users can manage their own campaign_plan_copy"
      on campaign_plan_copy
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
