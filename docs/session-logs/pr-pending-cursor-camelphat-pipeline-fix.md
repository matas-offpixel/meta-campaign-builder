# Session log — cursor/camelphat-pipeline-fix

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/camelphat-pipeline-fix`

## Summary

Three targeted fixes for the Camelphat (IRW0004) dashboard pipeline. The chart was ending two days early because Mailchimp snapshot dates beyond the last rollup row were silently dropped; the chart window is now the union of rollup and Mailchimp dates. The Mailchimp pre-snapshot registration ramp was underestimating launch-day signups; it now anchors one day earlier and uses a weighted-launch-burst curve (40 %/75 %/100 %) instead of a pure linear ramp. All 7 Ironworks events have `meta_campaign_id = NULL`, causing sporadic cron failures from unreliable name-based discovery; a new endpoint can resolve and persist campaign IDs on demand, and the cron now persists IDs on first discovery so subsequent runs use a direct campaign ID filter.

## Scope / files

- `components/dashboard/events/event-trend-chart.tsx` — extend `days` memo in `LegacyTrendChart` to include Mailchimp-only dates after the last rollup date
- `lib/mailchimp/sync.ts` — weighted ramp (0 % / 40 % / 75 %) anchored one day before first activity; `weighted_ramp_pre_snapshot` method label
- `components/dashboard/events/daily-tracker.tsx` — filter out both `linear_ramp_pre_snapshot` and `weighted_ramp_pre_snapshot` rows from REGS delta
- `lib/insights/types.ts` — add `campaignIds: string[]` to `DailyMetaMetricsResult` ok branch
- `lib/insights/meta.ts` — export `listCampaignsForEvent`; add `knownCampaignIds` param to `fetchEventDailyMetaMetrics` and `fetchEventTodayMetaSnapshot`; track and return `campaignIds` in both
- `lib/dashboard/rollup-sync-runner.ts` — add `metaCampaignId` to `RollupSyncInput`; pass `knownCampaignIds` to both Meta fetch calls; persist campaign IDs on first discovery
- `app/api/cron/rollup-sync-events/route.ts` — add `meta_campaign_id` to event select; pass to runner
- `app/api/events/[id]/meta/resolve-campaign-id/route.ts` (NEW) — POST endpoint to resolve Meta campaign IDs for an event and persist them; auth via session or CRON_SECRET

## Validation

- [x] `npm run build` — clean (exit 0)
- [ ] `npx tsc --noEmit` — pre-existing errors in `.next/dev/types/validator.ts` only; no new errors in changed files

## Notes

- To backfill the 7 Ironworks events immediately after deploy:
  ```bash
  CRON_SECRET=<secret>
  for ID in 68535c85-0394-435f-9439-245dd2e87043 2d5a5485-bfec-4812-9fcc-2f6f89262f6c 7daf4c63-eeb6-46f8-b3e4-5142d29b15fe 561b0536-4f68-4a42-aa6e-280f04b1b7fe 14d55718-ffa5-490e-b555-2423bc22f05e c0c1d907-045f-4982-ac41-ee396c04e23c f8603e89-0b0e-4b43-9984-0f3f3a0e906d; do
    curl -s -X POST "https://meta-campaign-builder.vercel.app/api/events/$ID/meta/resolve-campaign-id" \
      -H "Authorization: Bearer $CRON_SECRET" | jq .
  done
  ```
- The weighted ramp replaces the linear ramp; the `syncMailchimpTagDailyHistory` function must be called once per Ironworks event (via `/api/events/<id>/mailchimp/refresh`) to regenerate the ramp rows with the new weights and earlier anchor.
- Existing `linear_ramp_pre_snapshot` rows in the DB are correctly cleaned up on next `syncMailchimpTagDailyHistory` run (the cleanup step deletes all `source=mailchimp_tag_daily_history` rows before inserting new ones).
