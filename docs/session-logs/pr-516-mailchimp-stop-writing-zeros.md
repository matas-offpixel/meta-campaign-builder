# Session log

## PR

- **Number:** 516
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/516
- **Branch:** `cursor/mailchimp-stop-writing-zeros`

## Summary

Stops the Mailchimp daily sync from writing fabricated `email_subscribers = 0` rows when backward activity reconstruction is uncertain. Reconstruction now stops on negative running totals and activity gaps > 2 days, filters pre-`event_start_at` days, and only persists cumulative > 0. Migration 104 deletes Ironworks zero rows before 26 May.

## Scope / files

- `lib/mailchimp/activity-reconstruct.ts` — trusted-window reconstruction + write filter
- `lib/mailchimp/sync.ts` — pass `event_start_at`, skip empty trustworthy output
- `app/api/cron/rollup-sync-events/route.ts` — select/pass `event_start_at`
- `app/api/events/[id]/backfill-rollups/route.ts` — same
- `supabase/migrations/104_mailchimp_zero_snapshot_cleanup.sql`
- `lib/mailchimp/__tests__/activity-reconstruct.test.ts`

## Validation

- [x] `lib/mailchimp/__tests__/activity-reconstruct.test.ts` — 5 pass
- [x] `lib/mailchimp/__tests__/sync-daily-history.test.ts` — 13 pass
- [x] `npm run build`

## Notes

After deploy + cron, Ironworks should get accurate May 22+ rows when Mailchimp `/activity` returns correct daily subs for those days. Days outside the trustworthy window are omitted entirely (not written as zeros).
