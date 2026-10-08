# Google Ads performance: campaign grain, search terms, locations (PR 4a)

## PR

- **Number:** 1042
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1042
- **Branch:** `cursor/google-ads-performance`

## Summary

Read-only against Google Ads. A nightly cron (`/api/cron/google-ads-daily-insights`, 04:00 UTC, killswitch `ENABLE_GOOGLE_ADS_DAILY_INSIGHTS`) restates the last three complete days of campaign × day, search terms and user locations for every client Google Ads account into migration 192. The event grain stays in `event_daily_rollups.google_ads_*`. When the event rollup shows Google spend on a day with no campaign rows, the account is failed and cron-health shows it. Separately, a Search plan with no resolved location can no longer be pushed, and a video plan with none is blocked at Review. CamelPhat IRW0004 was pushed with `targets: []` and served in about 80 countries on 7–8 Oct.

## Scope / files

- `supabase/migrations/192_google_ads_campaign_insights.sql` (unapplied; Matas applies). Tables:
  - `google_ads_daily_snapshots`, unique on (campaign_resource_name, date).
  - `google_ads_search_terms_snapshots`, unique on (campaign, ad group, date, term, match type).
  - `google_ads_location_snapshots`, unique on (campaign, date, country, location type).
  - `google_ads_insights_runs`, the run log.
  - Also `google_ads_accounts.enabled_conversion_actions`.
  - Owner-only read RLS (`user_id = auth.uid()`); writes are service role only.
- `lib/google-ads/campaign-insights/`:
  - `queries.ts`: GAQL, every field verified live on v23.
  - `map.ts`: pure row mappers.
  - `runner.ts`: accounts, plan lookup, the rollup cross-check, window splitting on a full 10k-row page, upserts, the run log.
- `app/api/cron/google-ads-daily-insights/route.ts`, plus `vercel.json` (`0 4 * * *`).
- `scripts/backfill-google-ads-insights.mts`:
  - The dry run fetches (Google read-only) and writes nothing.
  - `--apply` writes. `--since`/`--until`, plus `--show-locations CODE`.
- cron-health:
  - New `failed` status: the latest run log row has `ok = false`. The failed accounts are listed under the table name.
  - Files: `lib/reporting/cron-health-monitor.ts`, `cron-health-monitor-format.ts`, `app/(dashboard)/admin/cron-health/page.tsx`.
- `lib/reporting/campaign-matching.ts`: `campaignEventCode`, the first `[CODE]` exactly as written.
- §4.4 items:
  - After a successful Search push, `linkEventGoogleAdsAccountIfUnset` fills a null `events.google_ads_account_id`.
  - "running blind" badge on `/google-ads` plan rows (`lib/google-ads/conversion-tracking.ts`).
  - `.toUpperCase()` on event codes in the Google path: none found. A test keeps the new module free of it.
- Push block:
  - `lib/google-search/validation.ts` adds `no_locations` (error): "No locations — this would run worldwide. Add at least one location." The push route already returns 422 on hard errors, before credentials or Google.
  - `lib/google-video/validation.ts` adds the same as a Review blocker.
- `CLAUDE.md`: env var, cron, migration 192.

## Validation

- [x] `npx tsc --noEmit`: no errors outside existing `__tests__` noise on main.
- [ ] `npm run build`: CI.
- [x] `npm test`: 7173 node tests and the vitest suite pass.
- [x] Backfill dry run, Ironworks 839-818-3094, 1 Sep → 8 Oct:
  - 135 campaign-day rows (£1,026.94), 3,233 search-term rows, 247 location rows.
  - 14 campaigns, all SEARCH.
  - 24 Google calls (+1 for country names). No failed windows.

## Notes

- `geographic_view` and `user_location_view` both work on v23. `geographic_view` is used because it carries `location_type`.
- `metrics.trueview_average_cpv` is in micros. Black Butter check: £140.15 ÷ 45,656 views = 3,069.7, matching the value.
- `metrics.conversions_value` is currency, so it is ×1e6 into `conversion_value_micros`.
- "Running blind" ignores GOOGLE_HOSTED actions (Google's own "Local actions"). Ironworks has an ENABLED WEBPAGE "Purchase", so it gets no badge. Whether that tag fires is a separate question.
- The Search block counts a target as a location only when `resolved_resource_name` is set. XLSX-imported targets that never went through the preview now block until they are resolved. That is deliberate: the live fallback in `geo-resolve.ts` has wrong IDs (out of scope here).
- `GoogleAdsClient.query` reads one 10k-row page. The runner halves a full window down to a day, and a full one-day page fails the account (`page_truncated`) rather than passing short.
