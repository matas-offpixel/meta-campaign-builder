-- Migration 266 — campaign creator: replicate, venue card, audience templates, campaign tree
--
-- One migration for R1, R2, R6 and R7 of the campaign creator update
-- (scratch/campaign-replicate/brief.md; design record
-- docs/design-record/2026-11-24-campaign-creator-replicate.html, RC1–RC7).
-- Only one migration can be unmerged on CI at a time, so everything those
-- items need is here. Additive only: new nullable columns, new tables, their
-- policies. Nothing is dropped, renamed or backfilled.
--
-- R2 · venue card (RC4). A venue holds an ad account and a pixel; an event
-- can override both (events.meta_ad_account_id exists since migration 172;
-- events.meta_pixel_id is new here, e.g. Sheffield's Skiddle pixel on its
-- Skiddle shows). venues.client_id is new too: the venue card lives under
-- Clients › {client} › Venues, and prod had no venue rows at all on 24 Nov
-- (events carry venue_key only), so a venue needs its client to be found.
-- Values come from scripts/seed-venue-meta-defaults.mts, never by hand.
--
-- R6 · audience templates (RC5). audience_templates sit under a business
-- manager (business_id) and, optionally, a client. confirmed_by /
-- confirmed_at carry RC5's "confirmed by {name} {date}"; an unconfirmed
-- template can't be applied. audience_template_items hold one audience role
-- each. family_key (a genre family key) is part of an item's key because one template can hold
-- two customer lists of the same role (RC-E: "Tech house buyers" and "Disco
-- buyers", both role buyers).
--
-- R7 · campaign tree (RC6). campaign_additions is the log of what was added
-- to which campaign and ad sets, per event and stage. A row the on-sale
-- refresh proposed points at its onsale_refresh_lines row.
--
-- RLS: owner policy on user_id, the same shape as campaign_drafts, and 251's
-- restrictive client-member write guard on every new table. The service role
-- bypasses RLS for cron and server-action writes.
--
-- Apply by hand: prod first, then CI, just before the PR merges. Idempotent.
-- Not applied from the branch.

-- ── R2: venue card and the event override ────────────────────────────────

alter table public.venues
  add column if not exists client_id uuid references public.clients (id) on delete set null,
  add column if not exists meta_ad_account_id text
    constraint venues_meta_ad_account_id_format check (meta_ad_account_id ~ '^(act_)?[0-9]+$'),
  add column if not exists meta_pixel_id text
    constraint venues_meta_pixel_id_format check (meta_pixel_id ~ '^[0-9]+$');

create index if not exists venues_client_id_idx
  on public.venues (client_id)
  where client_id is not null;

comment on column public.venues.client_id is
  'The client whose venue card this is (Clients › {client} › Venues). Null on venue rows made before migration 266.';
comment on column public.venues.meta_ad_account_id is
  'R2: the venue''s Meta ad account. A replicated draft takes it unless the event overrides it (events.meta_ad_account_id). Migration 266.';
comment on column public.venues.meta_pixel_id is
  'R2: the venue''s pixel. A replicated draft takes it unless the event overrides it (events.meta_pixel_id). Migration 266.';

alter table public.events
  add column if not exists meta_pixel_id text
    constraint events_meta_pixel_id_format check (meta_pixel_id ~ '^[0-9]+$');

comment on column public.events.meta_pixel_id is
  'R2: this event''s pixel when it isn''t the venue''s, e.g. a Sheffield Skiddle show on 1987031252241238. Null = the venue''s. Migration 266.';

-- ── R6: audience templates ───────────────────────────────────────────────

create table if not exists public.audience_templates (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  client_id       uuid        references public.clients (id) on delete cascade,
  business_id     text        check (business_id ~ '^[0-9]+$'),
  name            text        not null check (length(trim(name)) > 0),
  genre_families  text[]      not null default '{}'
    check (genre_families <@ array['house_tech', 'deep_afro', 'melodic_prog', 'disco', 'garage_bass', 'dnb', 'techno', 'hard_techno', 'commercial', 'no_single_genre']::text[]),
  notes           text,
  confirmed_by    uuid        references auth.users (id) on delete set null,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint audience_templates_confirmed_pair check ((confirmed_by is null) = (confirmed_at is null)),
  constraint audience_templates_name_unique unique nulls not distinct (user_id, business_id, name)
);

create index if not exists audience_templates_client_idx
  on public.audience_templates (client_id)
  where client_id is not null;

comment on table public.audience_templates is
  'R6: an audience template under a business manager, by genre family. Matas confirms one before it is used (confirmed_by / confirmed_at). Migration 266.';
comment on column public.audience_templates.genre_families is
  'Keys from lib/learning/genre/families.ts.';

create table if not exists public.audience_template_items (
  id                uuid        primary key default gen_random_uuid(),
  template_id       uuid        not null references public.audience_templates (id) on delete cascade,
  user_id           uuid        not null references auth.users (id) on delete cascade,
  kind              text        not null check (kind in ('customer_list', 'retargeting_pool', 'page_engagers', 'interest')),
  list_role         text,
  family_key        text        check (family_key in ('house_tech', 'deep_afro', 'melodic_prog', 'disco', 'garage_bass', 'dnb', 'techno', 'hard_techno', 'commercial', 'no_single_genre')),
  page_id           text        check (page_id ~ '^[0-9]+$'),
  retention_days    integer     check (retention_days > 0 and retention_days <= 365),
  interest_id       text,
  interest_name     text,
  meta_audience_id  text,
  detail            jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  constraint audience_template_items_shape check (
    (kind = 'customer_list' and list_role in ('signups', 'similar', 'buyers') and page_id is null and interest_id is null)
    or (kind = 'retargeting_pool' and list_role is not null and page_id is null and interest_id is null)
    or (kind = 'page_engagers' and page_id is not null and interest_id is null)
    or (kind = 'interest' and interest_id is not null and page_id is null and list_role is null)
  ),
  constraint audience_template_items_unique unique nulls not distinct
    (template_id, kind, list_role, family_key, page_id, retention_days, interest_id)
);

create index if not exists audience_template_items_template_idx
  on public.audience_template_items (template_id);

comment on table public.audience_template_items is
  'R6: one audience role in a template: a customer list by role, a retargeting pool, an artist page''s engagers, or an interest. Resolved by role in the target ad account, never by id. Migration 266.';
comment on column public.audience_template_items.list_role is
  'customer_list: signups | similar | buyers (as meta_custom_audiences.list_role). retargeting_pool: the pool, e.g. page_views | signups | video_viewers.';
comment on column public.audience_template_items.family_key is
  'The list''s genre when one template holds two lists of the same role (Tech house buyers, Disco buyers). Key from lib/learning/genre/families.ts.';
comment on column public.audience_template_items.meta_audience_id is
  'The audience this item was saved from, in the template''s own account. Never used in another ad account.';
comment on column public.audience_template_items.detail is
  'Display extras (name, platforms) that are not part of the role.';

-- ── R7: campaign tree additions ──────────────────────────────────────────

create table if not exists public.campaign_additions (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null references auth.users (id) on delete cascade,
  event_id                uuid        not null references public.events (id) on delete cascade,
  stage                   text        not null check (stage in ('signup', 'presale', 'on_sale', 'show_week')),
  meta_campaign_id        text        not null check (meta_campaign_id ~ '^[0-9]+$'),
  meta_adset_ids          text[]      not null default '{}',
  kind                    text        not null check (kind in ('creative', 'audience')),
  detail                  jsonb       not null default '{}'::jsonb,
  onsale_refresh_line_id  uuid        references public.onsale_refresh_lines (id) on delete set null,
  created_by              uuid        references auth.users (id) on delete set null,
  created_at              timestamptz not null default now()
);

create index if not exists campaign_additions_event_idx
  on public.campaign_additions (event_id, created_at);

create index if not exists campaign_additions_campaign_idx
  on public.campaign_additions (meta_campaign_id, created_at);

comment on table public.campaign_additions is
  'R7: one row per addition to one campaign: creatives or an audience, the ad sets it went to, who and when. "Add creatives to…" on a stage writes one row per campaign. Migration 266.';
comment on column public.campaign_additions.onsale_refresh_line_id is
  'Set when the on-sale refresh proposed this addition ("proposed by the on-sale refresh").';
comment on column public.campaign_additions.created_by is
  'Who added it. Null for a write the service role made with no person behind it.';

-- ── updated_at on templates ──────────────────────────────────────────────

create or replace function public.set_audience_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists audience_templates_set_updated_at on public.audience_templates;
create trigger audience_templates_set_updated_at
  before update on public.audience_templates
  for each row execute function public.set_audience_templates_updated_at();

-- ── RLS: owner, and 251's client-member write guard ──────────────────────

do $$
declare
  t text;
  tables text[] := array[
    'audience_templates',
    'audience_template_items',
    'campaign_additions'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'owner_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      'owner_all', t);
    execute format('drop policy if exists %I on public.%I', 'client_member_no_insert', t);
    execute format('drop policy if exists %I on public.%I', 'client_member_no_update', t);
    execute format('drop policy if exists %I on public.%I', 'client_member_no_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (not public.is_client_member())',
      'client_member_no_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (not public.is_client_member()) with check (not public.is_client_member())',
      'client_member_no_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (not public.is_client_member())',
      'client_member_no_delete', t);
  end loop;
end $$;
