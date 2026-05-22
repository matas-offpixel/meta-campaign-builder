-- Migration 098 — Google Search plan sitelinks.
--
-- The Phase 3 push adapter (PR #451) creates campaigns inheriting the
-- LWE account-level sitelinks ("What's On", "About Us", etc) which
-- point to LWE's general site, NOT the specific event landing page.
-- Result: J2 ads showed sitelinks pointing to the wrong pages.
--
-- Fix: per-plan sitelinks the operator can edit in the wizard. At
-- push time the adapter creates campaign-level sitelink assets and
-- links them to each pushed campaign — Google Ads generally prefers
-- campaign-level over account-level when both exist.
--
-- Account-level inheritance disable is NOT exposed by v23 per-campaign;
-- the adapter surfaces a launch-summary warning that the operator may
-- need to remove/pause the account-level sitelinks manually in Google
-- Ads if they still appear.
--
-- Idempotency mirrors the other Phase 1 child tables: every row carries
-- a `pushed_resource_name` the push adapter stamps after the first
-- successful link. RLS joins up to the plan owner — same pattern as
-- google_search_negatives (one-hop through google_search_plans).

create table if not exists google_search_sitelinks (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               uuid not null references google_search_plans(id) on delete cascade,
  link_text             text not null,
  description1          text,
  description2          text,
  final_url             text,
  sort_order            integer not null default 0,
  pushed_resource_name  text,
  created_at            timestamptz not null default now()
);

comment on table google_search_sitelinks is
  'Per-plan sitelinks pushed to every campaign in the plan at launch. Push adapter creates `assets:mutate` + `campaignAssets:mutate` calls with fieldType=SITELINK. final_url defaults to the campaign''s plan-level landing URL if NULL.';
comment on column google_search_sitelinks.link_text is
  'Sitelink text shown under the ad. Google Ads cap: 25 chars (validated in the wizard).';
comment on column google_search_sitelinks.description1 is
  'Optional description line 1. Google Ads cap: 35 chars (validated in the wizard).';
comment on column google_search_sitelinks.description2 is
  'Optional description line 2. Google Ads cap: 35 chars (validated in the wizard).';
comment on column google_search_sitelinks.final_url is
  'Per-sitelink landing URL override. NULL = inherit the plan/RSA default final URL at push time.';
comment on column google_search_sitelinks.pushed_resource_name is
  'Set by the push adapter to the `assets/{id}` resource name after the asset is created on Google Ads. Used for idempotency on re-push; the campaignAsset link itself is recreated on every push since it''s cheap and Google dedupes by (asset, campaign, fieldType).';

create index if not exists google_search_sitelinks_plan_idx
  on google_search_sitelinks (plan_id);

-- ─── RLS — mirrors google_search_negatives_owner exactly ───────────────
alter table google_search_sitelinks enable row level security;

drop policy if exists google_search_sitelinks_owner on google_search_sitelinks;
create policy google_search_sitelinks_owner on google_search_sitelinks
  for all
  using (
    auth.role() = 'service_role'
    or plan_id in (select id from google_search_plans where user_id = auth.uid())
  )
  with check (
    auth.role() = 'service_role'
    or plan_id in (select id from google_search_plans where user_id = auth.uid())
  );

notify pgrst, 'reload schema';
