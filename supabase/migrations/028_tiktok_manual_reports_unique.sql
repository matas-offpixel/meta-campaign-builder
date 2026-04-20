-- Migration 028 — unique constraint for tiktok_manual_reports upsert.
--
-- Why: the xlsx import route upserts on (user_id, campaign_name,
-- date_range_start, date_range_end). Without this constraint, re-importing
-- the same campaign for the same date range creates duplicate rows instead
-- of refreshing the snapshot. The constraint is narrow enough that two
-- different users can import the same TikTok campaign name independently,
-- and the same user can import the same campaign for different date windows
-- (e.g. weekly refresh cadence).

alter table tiktok_manual_reports
  add constraint tiktok_manual_reports_user_campaign_window_key
    unique (user_id, campaign_name, date_range_start, date_range_end);

notify pgrst, 'reload schema';
