# Session log — feat(mailchimp): daily subscriber API sync

## PR

- **Number:** 510
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/510
- **Branch:** `cursor/mailchimp-daily-sync`

## Summary

Implements an API-driven daily sync for Mailchimp audience subscriber history,
mirroring exactly how Eventbrite ticket sales are ingested for 4theFans events.
The sync writes one `mailchimp_audience_snapshots` row per day with the cumulative
active-subscriber count (`total_existing` reconstructed from daily deltas), which
feeds the canonical `cumulative_snapshot` aggregator in `trend-chart-data.ts`
to produce the Registrations line and CPR series on the brand_campaign Daily Trend chart.
Also wipes the 10 manually-inserted estimate rows for Ironworks and corrects
`event_start_at` to 22 May 2026 (when Mailchimp activity actually began).

## Scope / files

- `lib/mailchimp/client.ts` — added `getAudienceListActivity` + `MailchimpActivityRow` / `MailchimpListActivityResponse` types
- `lib/mailchimp/activity-reconstruct.ts` — **NEW** pure module: `reconstructDailyCumulatives` + `resolveMailchimpAudienceId` (extracted for testability, no `server-only`)
- `lib/mailchimp/sync.ts` — added `syncMailchimpAudienceDailyHistory`; refactored to use pure helpers; re-exports `resolveMailchimpAudienceId`
- `app/api/cron/rollup-sync-events/route.ts` — wired `syncMailchimpAudienceDailyHistory` inside the `brand_campaign` iteration; added `mailchimp_audience_id`, `kind`, `mailchimp_account_id` to select + `EventToSync` interface
- `app/api/events/[id]/backfill-rollups/route.ts` — added Mailchimp sync leg for `brand_campaign` events; response includes `mailchimpOk`, `mailchimpError`, `mailchimpRowsWritten`
- `supabase/migrations/102_cleanup_ironworks_mailchimp_snapshots.sql` — deletes manual estimate rows for Ironworks; sets `event_start_at = 2026-05-22`
- `lib/mailchimp/__tests__/sync-daily-history.test.ts` — **NEW** 13 tests for `reconstructDailyCumulatives` + `resolveMailchimpAudienceId`
- `lib/mailchimp/__tests__/getAudienceListActivity.test.ts` — **NEW** 3 tests verifying URL, auth header, count cap
- `__tests__/share-report/brand-campaign-chart-from-zero.test.ts` — **NEW** 6 regression tests for Ironworks-shape 22 May → 2 Jun fixture

## Validation

- [x] `npx tsc --noEmit` — no errors in changed files
- [x] `npm test` — 2008 pass, 5 fail (all 5 are pre-existing)
- [x] Supabase migration applied — 0 rows remaining for Ironworks in `mailchimp_audience_snapshots`, `event_start_at = 2026-05-22`

## Notes

- The chart canonical aggregator (`trimEmptyRange`) intentionally trims leading days where
  only cumulative-snapshot points exist and no spend is present. 22–24 May will therefore
  not appear on the chart (no ad spend those days), but the subscriber counts ARE stored
  correctly in the DB and surface on the MAILCHIMP AUDIENCE card.
- `getAudienceListActivity` returns DELTA counts per day. `reconstructDailyCumulatives`
  anchors to the live `member_count` from `getAudience()` and walks backwards.
- After the daily cron runs once post-deploy, Ironworks will have 12 rows (22 May → 2 Jun)
  with `source = 'mailchimp_api_daily_sync'` in `raw_json`.
