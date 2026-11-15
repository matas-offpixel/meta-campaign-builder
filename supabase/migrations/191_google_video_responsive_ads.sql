-- Migration 191 — YouTube video plans: responsive video ads.
--
-- Google Ads Editor now builds a new Video campaign as Target CPV, with
-- "Responsive video" ad groups and "Responsive video ad" ads. Manual CPV
-- and in-stream ad groups are deprecated. A responsive video ad has up to
-- five of each copy field (Headline 1..5, Long headline 1..5,
-- Description 1..5, Call to action 1..5) and a required Business name.
--
-- google_video_plans.business_name: written on every ad row of the
-- Editor file. Null blocks the download.
--
-- google_video_ads.extra_copy: slots 2..5, as
-- {"headline": [...], "long_headline": [...], "description": [...],
--  "call_to_action": [...]}. Slot 1 stays in the existing headline,
-- long_headline, description and call_to_action columns.
--
-- Requires 190. Additive. Matas applies. No backfill.

alter table google_video_plans add column if not exists business_name text;

alter table google_video_ads
  add column if not exists extra_copy jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'google_video_ads_extra_copy_object'
  ) then
    alter table google_video_ads
      add constraint google_video_ads_extra_copy_object
      check (jsonb_typeof(extra_copy) = 'object');
  end if;
end $$;

comment on column google_video_plans.business_name is
  'Business name on every responsive video ad. Required by Editor. Import defaults it from the event''s client, else its venue. Migration 191.';
comment on column google_video_ads.extra_copy is
  'Copy slots 2..5 per field: {headline, long_headline, description, call_to_action} → text[]. Slot 1 is the scalar column. Migration 191.';
comment on column google_video_plans.device_exclusions is
  'CONNECTED_TV excluded unless the operator opts in. Not in the Editor file: set "Include Google TV: Disabled" by hand in Editor.';
