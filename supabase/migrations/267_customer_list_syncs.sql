-- 267: signups into Meta going into on sale (SU1), engine only.
--
-- Spec: scratch/campaign-replicate/signups-to-meta.md ("Matas's answers",
-- 24 Nov), rebuilt on CIRQLIN's live hashed read (cirqlin #682). A show's
-- consented CIRQLIN signups (scope=show) reach Meta as the show's own
-- "{code} · Signups" customer list, made on presale day 08:00 London (general
-- sale with no presale) in the event's ad account. Registered as
-- meta_custom_audiences with list_role 'signups' so Retargeting's Bottom tier
-- reads it. Kept current daily from CIRQLIN's cursor (adds, and removes for
-- withdrawn, deleted or flagged fans), and fully replaced weekly
-- (last_replaced_at): a GDPR erasure never shows in CIRQLIN's removes, so the
-- replace is what drops it, within 7 days.
--
-- No other list is written. Genre and high-value lists the app didn't make
-- get nothing; a show's list joins its audience templates instead: one
-- customer_list / signups item per show list, with its meta_audience_id.
-- 266's audience_template_items_unique can't hold two of those in one
-- template (they differ only in meta_audience_id), so this migration
-- rebuilds it with meta_audience_id as the eighth column, nulls not
-- distinct. Widening a unique key never fails on rows already there (prod
-- had 0 on 24 Nov). Every upsert on the old seven columns must name
-- meta_audience_id too (#1363: the seed and lib/actions/audience-templates.ts).
--
-- One row per (event, kind, Meta list); kind is 'show' only, kept as a
-- column for a later list the app makes. A row is written by
-- scripts/customer-list-sync.mts --enable before its list exists, so its
-- meta_audience_id starts null; the unique key treats nulls as equal so an
-- event has one pending show row at most.
--
-- No person data. CIRQLIN serves SHA-256 hashes only and the app holds them
-- in memory for the upload; this table keeps CIRQLIN's opaque sync cursor and
-- counts. last_error carries counts and Meta's error code, never a hash.
--
-- meta_write_idempotency gains two op kinds:
--   customer_list_create  POST /act_{id}/customaudiences, one per show list.
--   customer_list_users   one batch of up to 10,000: POST or DELETE
--                         /{audience_id}/users (key op add / remove, with
--                         CIRQLIN's cursors) or POST /{audience_id}/usersreplace
--                         (key op replace, with the session id and batch_seq).
--                         Never keyed on the hashes.
-- The CHECK is re-added by name with exactly the kinds live on prod, read
-- from pg_constraint on 24 Nov after 257 was applied (20261124184926): 22
-- kinds, which already hold these two (257 re-added them). Re-adding them
-- here keeps 267 complete on a database without 257.
--
-- Service role only: RLS on, no policy for anon or authenticated. Writes come
-- from the cron and the script with the service-role key.
--
-- Additive. Unapplied: ops applies on prod before merge.

create table if not exists public.customer_list_syncs (
  id                uuid        primary key default gen_random_uuid(),
  event_id          uuid        not null references public.events (id) on delete cascade,
  kind              text        not null default 'show' check (kind in ('show')),
  meta_audience_id  text        check (meta_audience_id ~ '^[0-9]+$'),
  ad_account_id     text        not null check (ad_account_id ~ '^act_[0-9]+$'),
  enabled           boolean     not null default false,
  cursor            text,
  sent_total        integer     not null default 0 check (sent_total >= 0),
  removed_total     integer     not null default 0 check (removed_total >= 0),
  last_sent_at      timestamptz,
  last_replaced_at  timestamptz,
  last_replace_count integer    check (last_replace_count >= 0),
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint customer_list_syncs_unique unique nulls not distinct (event_id, kind, meta_audience_id)
);

create index if not exists customer_list_syncs_enabled_idx
  on public.customer_list_syncs (event_id)
  where enabled;

create or replace function public.set_customer_list_syncs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists customer_list_syncs_updated_at on public.customer_list_syncs;
create trigger customer_list_syncs_updated_at
  before update on public.customer_list_syncs
  for each row execute function public.set_customer_list_syncs_updated_at();

alter table public.customer_list_syncs enable row level security;
revoke all on public.customer_list_syncs from anon, authenticated;

comment on table public.customer_list_syncs is
  'SU1: one row per event and the show''s own Meta customer list the signup sync writes to. Counts and CIRQLIN''s cursor only, never a hash. Service role only.';

comment on column public.customer_list_syncs.last_replaced_at is
  'The last weekly full replace (POST /{id}/usersreplace from a no-cursor CIRQLIN read): Mondays 08:00 London, or the first run 7 days after the last. Drops GDPR erasures, which never appear in CIRQLIN''s removed.';

-- ── audience_template_items: one item per show list ─────────────────────────

alter table public.audience_template_items
  drop constraint if exists audience_template_items_unique;

alter table public.audience_template_items
  add constraint audience_template_items_unique unique nulls not distinct
    (template_id, kind, list_role, family_key, page_id, retention_days, interest_id, meta_audience_id);

comment on constraint audience_template_items_unique on public.audience_template_items is
  'One item per role, page, interest and (migration 267) Meta list: a template holds every show''s "{code} · Signups" list as its own customer_list / signups item.';

-- ── meta_write_idempotency: the two op kinds ────────────────────────────────

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
    'refresh_adset_create',
    'refresh_custom_conversion_create',
    'refresh_campaign_create',
    'refresh_campaign_lifetime_budget_update',
    'refresh_campaign_status_update',
    'retargeting_audience_rule_update',
    'retargeting_study_create',
    'retargeting_study_end',
    'adset_end_time_update',
    'customer_list_create',
    'customer_list_users'
  ));
