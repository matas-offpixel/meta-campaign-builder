-- Migration 237 — the on-sale refresh, P3: audiences and budget
--
-- docs/design-record/2026-11-12-on-sale-refresh.html, R4, R5, HR4, and
-- design's P3 ruling on the two new-ad-set kinds (interest-cluster
-- bring-back, missing standing default).
--
-- 1. Three new op kinds on the Meta write ledger, so a double click or a
--    retry never re-sends a write:
--      adset_status_update          the gated ad-set status write
--                                   (lib/meta/adset-status-write.ts): Bring
--                                   back and Drop.
--      refresh_adset_budget_update  one side of a budget move: a
--                                   within-campaign move, or the money a new
--                                   ad set takes from another (the
--                                   optimisation budget write's POST).
--      refresh_adset_create         the new ad set a cluster bring-back or a
--                                   standing default makes (launch path).
--    The CHECK keeps every kind 156, 179, 180 and 236 installed.
-- 2. onsale_refresh_audiences: the audiences and ad sets a standing default
--    or a cluster bring-back made, stored on the event. A retry reuses the
--    stored audience id and never builds a second audience; the next
--    refresh sees a default whose ad set exists and doesn't propose it
--    again. Registrations come from the pixel only: no customer list.
--
-- 236 is applied. 234 (#1217) and 235 (#1218) are open and unapplied;
-- 237 goes after them. It touches meta_write_idempotency's CHECK and adds
-- its own table, so it does not depend on either.
--
-- Write only. Not applied from this branch. Ops applies from main.

alter table public.meta_write_idempotency
  drop constraint if exists meta_write_idempotency_op_kind_check;

alter table public.meta_write_idempotency
  add constraint meta_write_idempotency_op_kind_check
  check (op_kind in (
    'campaign_create',
    'adset_create',
    'ad_create',
    'creative_upload',
    'adset_targeting_update',
    'adset_destination_update',
    'refresh_creative_create',
    'refresh_ad_create',
    'ad_status_update',
    'adset_status_update',
    'refresh_adset_budget_update',
    'refresh_adset_create'
  ));

create table if not exists public.onsale_refresh_audiences (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- '' for an audience (shared by the event's campaigns); the campaign name for an ad set.
  campaign_key      text not null default '',
  kind              text not null check (kind in ('retargeting', 'registrations_lookalike', 'cluster')),
  -- Audiences: landing · ticket · video · registrations · lookalike. The ad set: adset.
  part              text not null check (part in ('landing', 'ticket', 'video', 'registrations', 'lookalike', 'adset')),
  meta_audience_id  text,
  meta_adset_id     text,
  name              text,
  line_id           uuid references public.onsale_refresh_lines (id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (event_id, kind, part, campaign_key)
);

comment on table public.onsale_refresh_audiences is
  'What a standing default or a cluster bring-back made (P3): each audience id (pixel and video sources only, never a customer list) and the new ad set, on the event. Retries reuse them. Migration 237.';

alter table public.onsale_refresh_audiences enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onsale_refresh_audiences' and policyname = 'Users can read their own onsale_refresh_audiences'
  ) then
    execute 'create policy "Users can read their own onsale_refresh_audiences" on public.onsale_refresh_audiences for select using (auth.uid() = user_id)';
  end if;
end $$;

notify pgrst, 'reload schema';
