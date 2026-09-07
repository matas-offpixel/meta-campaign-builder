# Session log

## PR

- **Number:** 917
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/917
- **Branch:** `cursor/tiktok-spark-post-picker`

## Summary

#916 lists the ad asset library. Folamour's organic posts are Spark Ads and are not in that library. This PR adds `choose a post from the feed` against the confirmed `GET /tt_video/list/` endpoint, and maps each `SPARK_AD` creative to the identity on that post — not the draft's `accountSetup` default.

Live probe (read-only, 2026-09-07): HTTP 200, TikTok `code: 0`, `{ list, page_info }`. Electric Group (`7681317718284304385`) had `total_number: 0` — a real empty authorisation list. Other stored advertisers returned rows whose keys match the doc: `item_info` / `user_info` / `auth_info` / `video_info`. Live `user_info.identity_type` is `AUTH_CODE` (Electric Brixton's client default is `BC_AUTH_TT`). Live `ad_auth_status` includes both `AUTHORIZED` and `EXPIRED`.

`item_types: ["VIDEO"]` only. `CAROUSEL` is a photo post and the creative model has no shape for it — excluded at the request, not dropped after a failed ad create.

## Scope / files

- `lib/tiktok/spark-posts.ts` — list helper, copy, auth/public helpers
- `app/api/tiktok/creative/spark-posts/route.ts` — session auth + `readTikTokAccountCredentials`
- `components/tiktok-wizard/tiktok-spark-post-picker.tsx` — paginated grid; fetch on open
- `components/tiktok-wizard/steps/creatives.tsx` — fourth way in; shared by the plan drawer and `/tiktok-campaign/[id]`
- `lib/tiktok/write/mapping.ts` — SPARK_AD prefers the creative's identity; VIDEO_REFERENCE unchanged
- `lib/types/tiktok-draft.ts` — optional identity fields on the creative
- `lib/tiktok/video-preview.ts` — one-hour poster TTL
- `lib/plan/drawer.ts` — `needsVideoTip` mentions the feed (drawer InfoTip only)

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5396 pass, 3 skipped)

## Notes

No new frame. Drawers are not in the catalog; canvas files are untouched. Authorising a post (`/tt_video/authorize/`) is a write and is not in this PR. `ENABLE_PLAN_FANOUT` and `OFFPIXEL_TIKTOK_WRITES_ENABLED` are untouched. No launch caller added.
