-- Migration 159 — campaign_plans start/end time-of-day
--
-- Plan spine collected dates only; Meta and TikTok need a time of day.
-- Nullable so existing rows keep the adapter defaults (Meta midnight UTC,
-- TikTok 09:00/21:00Z). Google stays date-level and ignores these columns.
--
-- Foundation only. Apply manually after review. Do not apply in this run.

alter table campaign_plans
  add column if not exists start_time time,
  add column if not exists end_time time;

comment on column campaign_plans.start_time is
  'Optional time of day (HH:MM) for Meta start_time ISO and TikTok advertiser-tz schedule. Null = existing date-only adapter defaults. Not sent to Google.';
comment on column campaign_plans.end_time is
  'Optional time of day (HH:MM) for Meta end_time ISO and TikTok advertiser-tz schedule. Null = existing date-only adapter defaults. Not sent to Google.';

notify pgrst, 'reload schema';
