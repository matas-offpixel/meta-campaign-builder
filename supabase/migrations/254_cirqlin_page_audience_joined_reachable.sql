-- 254_cirqlin_page_audience_joined_reachable.sql
--
-- HE2: cirqlin #647 adds community_joined_reachable to
-- GET /api/partner/page-audience: the signups who joined the community and
-- are counted in whatsapp_with_phone (the same spam rule). All time it is at
-- most both. Additive; null for a row fetched before CIRQLIN returned it.
-- The read helper's join rate is this over whatsapp_with_phone, all time only.
--
-- 253 is held by an open PR (events.genre_family); this takes 254.

alter table public.cirqlin_page_audience
  add column if not exists community_joined_reachable integer
    check (community_joined_reachable is null or community_joined_reachable >= 0);

comment on column public.cirqlin_page_audience.community_joined_reachable is
  'Signups who joined the community and are in whatsapp_with_phone (cirqlin #647). Null: fetched before CIRQLIN returned it.';
