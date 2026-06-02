-- Migration 102: cleanup Ironworks Mailchimp snapshots + fix event_start_at
--
-- The Ironworks brand_campaign event (68535c85-0394-435f-9439-245dd2e87043)
-- had manually-inserted estimate rows in mailchimp_audience_snapshots written
-- via MCP analytics or manual SQL before the API sync existed.
-- These are deleted here so the daily API sync can repopulate with accurate
-- per-day cumulative subscriber counts.
--
-- event_start_at is also corrected from 2026-05-25 (first ad spend day) to
-- 2026-05-22 (the day Mailchimp activity actually began: 3 subscribers).
-- This ensures the campaign window in trend charts starts at the correct date.

-- Delete manually-inserted estimate rows for Ironworks.
-- API sync will repopulate with source = 'mailchimp_api_daily_sync'.
delete from mailchimp_audience_snapshots
where event_id = '68535c85-0394-435f-9439-245dd2e87043'
  and (
    raw_json->>'source' in ('estimate', 'manual_baseline', 'mailchimp_mcp_analytics')
    or raw_json is null
    or (raw_json->>'source') is null
  );

-- Correct campaign start date so chart window begins when Mailchimp
-- activity started (3 subscribers on 22 May), not when ad spend started
-- (25 May). The VenueTrend chart uses event_start_at as the "zero" anchor.
update events
set event_start_at = '2026-05-22 00:00:00+00'
where id = '68535c85-0394-435f-9439-245dd2e87043'
  and (event_start_at is null or event_start_at != '2026-05-22 00:00:00+00');
