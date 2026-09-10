# Session log

## PR

- **Number:** 927
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/927
- **Branch:** `cursor/tiktok-capture-four-wires`

## Summary

Read-and-record the four TikTok response shapes that cost money when a field name is wrong, for advertiser `7639802149165301776` (Ironworks), 2026-09-10. Replaced the authored fixtures with the verbatim rows. Added `logUnmatchedCandidates` so an alternate-key walk that matches nothing is no longer a silent null.

Round 2: the captured pixel row proved `activity_status` is the live key. The mapper now walks `activity_status` then `status` through `logUnmatchedCandidates`. The suite is green. `pixel_name` / `name` and the `pixels` / `list` envelope already walked correctly — left as they were.

## Scope / files

- `lib/tiktok/__tests__/captured-ironworks-2026-09-10.ts` — four CAPTURED rows (untouched in round 2)
- `lib/tiktok/__tests__/{pixel,advertiser,insights,creative}.test.ts` — authored fixtures replaced
- `lib/tiktok/unmatched-candidates.ts` + test — miss alarm
- `lib/tiktok/{identity,pixel,creative,audience,upload,image-upload}.ts` — log when no alternate matched
- `lib/tiktok/pixel.ts` — round 2: `PIXEL_STATUS_CANDIDATE_KEYS` (`activity_status`, `status`)

Did not touch: `lib/tiktok/write/**`, drawers, `OFFPIXEL_TIKTOK_WRITES_ENABLED`, frame baselines, `reportRow()` goal-math fixtures.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 5461 pass, 4 skipped (pre-existing; none added)
- [x] `frames:check` — no frame file touched, no baselines regenerated. Local Darwin diffs Ubuntu baselines (env/render, not this change). CI is the authority.

## Notes

**`GET /pixel/list/`** envelope keys: `page_info`, `pixels` (not `list`). One pixel, `pixel_name: Ironworks Pixel`, `activity_status: ACTIVE` (no `status`). Mapper already read `pixels` / `list` and `pixel_name` / `name`. Round 2 walks status the same way identity walks `avatar_url`.

**`GET /report/integrated/get/`** first window `2026-07-01`–`2026-09-10` was rejected (`40002`, max 30 days with `stat_time_day`). Retry `2026-08-12`–`2026-09-10` succeeded. `list[0]` is a zero-spend day. Authored `reportRow()` goal-math fixtures left in place.

**`GET /advertiser/info/`** row is only `{ display_timezone: "Europe/London", timezone: "Etc/GMT", currency: "GBP" }`. No `advertiser_id` on the row. Confirms #920 Etc/GMT vs London.

**`GET /file/video/ad/info/`** has `video_cover_url` and `preview_url`. No `thumbnail_url`. Fallbacks settle on `video_cover_url`. `duration` is the number `19.633`.
