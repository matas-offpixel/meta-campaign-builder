# Learning loop A — ad facts (`launched_ads` + `ad_daily_insights`)

## PR

- **Number:** 1028
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1028
- **Branch:** `cursor/learning-loop-ad-facts`

## Summary

The data foundation CR.1–CR.4 (`docs/CREATIVE_INTELLIGENCE_WORKSTREAM_2026-08-21.md`) and plan-v2 audit two §5–6 both assume. It adds two fact tables. `launched_ads` (migration 184) has one row per Meta ad this app creates, with a launch-time creative descriptor. `ad_daily_insights` (migration 185) has one row per Meta ad per day for every ad on a client ad account, filled nightly. `resolveAdContext` joins any ad to its client and event. This PR has no scoring, no UI and no recommendations.

## Scope / files

- `supabase/migrations/184_launched_ads.sql`: mirrors 175. RLS is own rows. Indexes on `draft_id`, `event_id`, `(client_id, launched_at desc)` and `meta_adset_id`.
- `supabase/migrations/185_ad_daily_insights.sql`: unique `(meta_ad_id, date)`, with three `(…, date)` indexes. Writes are service-role only.
- `lib/launched-ads/record.ts` + `launch-recorder.ts`: the never-throw recorder. It has a 3 s upsert timeout, uses the service role with a session fallback, and loads event, client and asset hashes once per run.
- Wired into:
  - `app/api/meta/launch-campaign/route.ts`, in Phase 4 and the multi-campaign loop. In attach modes the campaign id comes from the attach target.
  - `app/api/meta/bulk-attach-ads/route.ts`
  - `app/api/meta/create-creatives-and-ads/route.ts`
  - The last two have no draft. Draft, client and event come from the ad set's `launched_ad_sets` row.
- `lib/launched-ads/backfill.ts` + `scripts/backfill-launched-ads.mts`: dry-run by default, `--apply` to write, no Meta calls.
- `lib/ad-daily-insights/{derive,fetch,runner}.ts` + `app/api/cron/ad-daily-insights/route.ts`. The cron runs at 02:30 UTC (`vercel.json`) behind `ENABLE_AD_DAILY_INSIGHTS=1`. It is registered in `lib/reporting/cron-health-monitor.ts` at 26 h.
- `scripts/backfill-ad-daily-insights.mts`: `--account --since --until`, 7-day windows, a 2 s pause before every call, `--apply`. Not run.
- `lib/learning/ad-facts.ts`: `resolveAdContext` plus `loadAdContextIndex`.
- `CLAUDE.md`: env var, latest migration, cron list.

## Meta fields string (cron and insights backfill)

`spend,impressions,reach,clicks,inline_link_clicks,actions,video_15_sec_watched_actions,video_p100_watched_actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name`

The request also sends `level=ad`, `time_increment=1`, `time_range` = last three complete UTC days, `filtering=[spend GREATER_THAN 0]`, `action_attribution_windows=["7d_click","1d_view"]` (the same windows as `event_daily_rollups`) and `limit=500`. It falls back to 100 and then 25 on "reduce the amount of data". Every call is a single attempt (`maxAttempts: 1`), so `meta_calls` in the log is the true cost.

There are two deviations from the brief. Both were measured with a read-only GET on 4TheFans, 2026-10-04..06, 37 rows:

1. `video_play_actions` was dropped. It counts plays from the first frame, not 3 s: 4 vs 0, 10 vs 1 and 9 vs 5 against `actions[video_view]`. 3 s plays come from `actions[video_view]`, the same as `event_daily_rollups.meta_video_plays_3s`.
2. `video_15_sec_watched_actions` was added as a field. `actions[video_15_sec_watched_actions]`, which the rollups read, was 0 on all 30 video rows; the field carried the data. Fixing the rollups is out of scope.

## Action types

- **Registrations:** `offsite_conversion.fb_pixel_complete_registration`, else `complete_registration`.
- **Leads:** `offsite_conversion.fb_pixel_lead`, else `lead`.
- **Purchases:** `offsite_conversion.fb_pixel_purchase` only.

Within each list the first type present wins, and the list is never summed. Meta reports the pixel type and the plain alias with the same value: 4/4 registration rows and 20/20 lead rows were equal, so a sum would double-count. `view_content` is in no list. `REGISTRATION_ACTION_TYPES` from `lib/meta/creative-insights.ts` is not reused because it includes `view_content`.

Everything else stays in `actions`. That includes `omni_complete_registration`, `onsite_web_lead`, `offsite_complete_registration_add_meta_leads` and `omni_landing_page_view`.

`result_action_type` is the type behind the first non-zero value of registrations, then leads, then purchases.

## RLS deviation on 185

The brief said "authenticated read (no user_id)", the same as `event_daily_rollups`. In fact `event_daily_rollups` is owner-scoped (`auth.uid() = user_id`, migration 039). A blanket authenticated read would let every client-dashboard user (`client_users`) read every client's per-ad spend.

So 185 reads are limited to the operator who owns a client or event on that ad account, matched with or without the `act_` prefix. The table still has no `user_id`. Service-role jobs are unaffected.

## Dry runs (no Meta calls)

**`launched_ads` backfill, prod read:**
- 135 drafts scanned; 108 have launched ads; 3,451 distinct ads.
- It would write 3,337 rows.
  - 166 of them have an ad set that can't be resolved (`meta_adset_id` null). These are attach-mode live ad sets recorded by name only.
  - 56 have a creative no longer on the draft, so the descriptor is the name only.
- 114 ad ids are claimed by more than one draft (copies). They are reported and not written.
- 194 of 194 registry asset hashes were found.
- `url_tags_applied` is null on backfilled rows because most predate PR #1027.

**Insights backfill example:**
- `--account act_10151014958791885 --since 2026-07-01 --until 2026-10-06` gives 14 windows, so at least 14 calls and about 26 s of pauses.
- Each window costs one call, plus one per extra page of 500 ad-days.

## Nightly call estimate

15 distinct accounts. Pages per account = ads with spend × 3 days ÷ 500, using the last 7 days of `active_creatives_snapshots`:

| Account | Basis | Pages |
|---|---|---|
| `act_672348543110654` | ~806 ads | ~5 |
| `act_1073273492854557` | ~361 ads | ~3 |
| `act_968594768066330` | 63 ads | 1 |
| `act_10151014958791885` | measured: 37 rows | 1 |
| 11 others | no recent snapshot | 1 each |

That is about 21 calls a night, against the 1,343 a day the thumbnail edge used to burn.

## `campaign_daily_insights`

This PR does not write it. Campaign grain is a SUM over `ad_daily_insights` grouped by `meta_campaign_id` and `date`. Branch `cursor/campaign-daily-insights` ([#958](https://github.com/matas-offpixel/meta-campaign-builder/pull/958), migration 178) should be closed, or rebased so that it reads from this table.

## Not verified

- Neither migration has been applied (Matas applies, prod first). Every write path logs and continues until then.
- No live launch has written a `launched_ads` row yet.
- Multi-campaign attach ads beyond the first campaign were never in `launchSummary`, so the backfill cannot see them. Only new launches record them.
- Bulk-attach and create-creatives ads into ad sets with no `launched_ad_sets` row get null draft, client and event. `resolveAdContext` then falls back to the campaign code.
- Page counts for the 11 accounts without recent snapshots.
- That `META_ACCESS_TOKEN` can read every one of the 15 accounts. Any that fail show as `auth_error` or `error` in the response.
- The cron-health row reads "missing" until 185 is applied and the flag is on.

## Validation

- [x] `npx tsc --noEmit`: no errors in touched files (the baseline has unrelated test-file errors)
- [x] `npm run build`
- [x] `npm test`: 6,760 node tests pass, 0 fail; vitest 6/6
