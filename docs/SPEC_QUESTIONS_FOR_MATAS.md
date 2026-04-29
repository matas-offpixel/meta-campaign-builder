# Spec Questions For Matas

## TikTok Share Report

1. Should the live TikTok top-line temporarily fall back to manual XLSX values for metrics not present in `event_daily_rollups` (`reach`, `frequency`, `cost_per_1000_reached`, `video_views_2s`, `video_views_6s`, `avg_play_time_per_user`)?
   - Default used overnight: no fallback; render unavailable until snapshot data lands.

2. Should brand-campaign share reports use the manual import date range or the event row's `event_start_at` to `campaign_end_at` as the canonical TikTok API window?
   - Default used overnight: manual import range first, event/brand dates as fallback.
