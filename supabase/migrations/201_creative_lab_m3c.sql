-- Migration 201 — Creative Lab M3c: artist identity and the ad set a round attaches to.
--
-- Write only. Not applied from this branch. Claude applies it after merge.
-- Does not launch anything.

alter table creative_lab_artists
  add column if not exists meta_page_id text,
  add column if not exists instagram_actor_id text;

comment on column creative_lab_artists.meta_page_id is
  'The artist''s own Facebook Page for artist_first_person ads. Null means no artist-voice ads.';
comment on column creative_lab_artists.instagram_actor_id is
  'The Instagram account connected to that Page, the ads-valid actor id. Null means no artist-voice ads. Never pair the artist Page with the promoter Instagram.';

alter table creative_lab_rounds
  add column if not exists meta_campaign_objective text,
  add column if not exists meta_adset_name text,
  add column if not exists meta_adset_status text;

comment on column creative_lab_rounds.meta_campaign_objective is
  'The objective recorded for this ad set on launched_ad_sets or the campaign draft. Propose refuses when it is unknown. Not a hardcoded OUTCOME_SALES.';
comment on column creative_lab_rounds.meta_adset_name is
  'The ad set name from launched_ad_sets.source_name or the draft, not the ad set id.';
comment on column creative_lab_rounds.meta_adset_status is
  'The ad set status from the draft snapshot. Null when the record has none.';
