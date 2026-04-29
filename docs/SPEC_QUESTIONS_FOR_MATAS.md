# Spec Questions For Matas

## TikTok Share Report

1. Should the live TikTok top-line temporarily fall back to manual XLSX values for metrics not present in `event_daily_rollups` (`reach`, `frequency`, `cost_per_1000_reached`, `video_views_2s`, `video_views_6s`, `avg_play_time_per_user`)?
   - Default used overnight: no fallback; render unavailable until snapshot data lands.

2. Should brand-campaign share reports use the manual import date range or the event row's `event_start_at` to `campaign_end_at` as the canonical TikTok API window?
   - Default used overnight: manual import range first, event/brand dates as fallback.

## TikTok Campaign Creator

1. Should TikTok drafts appear in the existing campaign library, or should TikTok get its own library surface?
   - Default used overnight: separate route and draft tables; library integration deferred.

2. Should Spark Ads ship in v1?
   - Default used overnight: include a typed creative mode placeholder, but no functional fields yet.

3. Should Smart+ be modelled as a bid strategy, an optimisation toggle, or both?
   - Default used overnight: both fields exist in the draft type so the UI can narrow later.

4. Should one TikTok draft support multiple advertisers?
   - Default used overnight: no; one advertiser per draft.

5. Should the disabled Review & Launch step be visible before TikTok write APIs are enabled?
   - Default used overnight: yes, but launch remains a placeholder with no write surface.
