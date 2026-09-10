# Session log

## PR

- **Number:** 927
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/927
- **Branch:** `cursor/tiktok-capture-four-wires`

## Summary

Read-and-record only. Captured the four TikTok response shapes that cost money when a field name is wrong, for advertiser `7639802149165301776` (Ironworks), 2026-09-10. Replaced the authored fixtures with the verbatim rows. Added `logUnmatchedCandidates` so an alternate-key walk that matches nothing is no longer a silent null. No mapper field-name fixes.

## Scope / files

- `lib/tiktok/__tests__/captured-ironworks-2026-09-10.ts` — four CAPTURED rows
- `lib/tiktok/__tests__/{pixel,advertiser,insights,creative}.test.ts` — authored fixtures replaced
- `lib/tiktok/unmatched-candidates.ts` + test — miss alarm
- `lib/tiktok/{identity,pixel,creative,audience,upload,image-upload}.ts` — log when no alternate matched; key order unchanged

Did not touch: `lib/tiktok/write/**`, drawers, `OFFPIXEL_TIKTOK_WRITES_ENABLED`, frame baselines.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 5458 pass, 4 skipped, **1 fail** (left red): `fetchTikTokPixels` maps captured Ironworks row as `status: null` because the mapper reads `status` and the live field is `activity_status`
- [x] `frames:check` — no frame file touched, no baselines regenerated

## Notes

**`GET /pixel/list/`** envelope keys: `page_info`, `pixels` (not `list`). One pixel, `pixel_name: Ironworks Pixel`, `activity_status: ACTIVE` (no `status`). `events` has four rows: `PAGE_VIEW` (`optimization_event: null`), `ON_WEB_REGISTER`, `LANDING_PAGE_VIEW`, `ENGAGED_SESSION`. The 9 Sep `/api/tiktok/pixels` `events: []` was the wrapper omitting `pixel_id` (`Promise.resolve([])`), not empty TikTok data. Mapper still reads `row.status` → mapped status is `null`. That failing assertion is left red.

**`GET /report/integrated/get/`** first window `2026-07-01`–`2026-09-10` was rejected (`40002`, max 30 days with `stat_time_day`). Retry `2026-08-12`–`2026-09-10` succeeded. `list[0]` is a zero-spend day. Metrics include `video_play_actions`, not `video_play`. `stat_time_day` is `"2026-09-01 00:00:00"`. Authored `reportRow()` goal-math fixtures left in place.

**`GET /advertiser/info/`** row is only `{ display_timezone: "Europe/London", timezone: "Etc/GMT", currency: "GBP" }`. No `advertiser_id` on the row. Confirms #920 Etc/GMT vs London.

**`GET /file/video/ad/info/`** has `video_cover_url` and `preview_url`. No `thumbnail_url`. Fallbacks settle on `video_cover_url`. `duration` is the number `19.633`.
