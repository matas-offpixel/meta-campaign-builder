-- Migration 257 — the Retargeting campaign's stored audiences, one row per window
--
-- docs/design-record/2026-11-17-retargeting-campaign.html (RT2) and
-- docs/design-record/2026-11-17-retargeting-campaign-2.html (RT13, RT14).
--
-- The Retargeting campaign's Apply (lib/retargeting/apply.ts) stores each
-- tier audience it builds in onsale_refresh_audiences under
-- kind = 'retargeting_campaign', with `part` set to the audience's stable key
-- ("bottom:ticket:7", "mid_bottom:page:60", "mid:video:{page}:1:90", …), so a
-- Retry reuses it instead of building a second one. Migration 237's part
-- CHECK allows only the refresh's six parts, so that insert would fail.
--
-- The check now keeps the six parts for every other kind and lets a
-- retargeting_campaign row carry its key. Every existing row passes: on
-- 17 Nov prod held only retargeting and registrations_lookalike rows, all
-- on the six parts.
--
-- The live definition is "CHECK ((part = ANY (ARRAY[...])))", so the old
-- check is dropped by name, not matched on its text (see 256).
--
-- Write only. Not applied from this branch. Matas applies from main.

alter table public.onsale_refresh_audiences
  drop constraint if exists onsale_refresh_audiences_part_check;

alter table public.onsale_refresh_audiences
  add constraint onsale_refresh_audiences_part_check
  check (
    part in ('landing', 'ticket', 'video', 'registrations', 'lookalike', 'adset')
    or (kind = 'retargeting_campaign' and length(part) between 1 and 200)
  );

notify pgrst, 'reload schema';
