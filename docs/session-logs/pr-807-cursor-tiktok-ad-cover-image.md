# Session log

## PR

- **Number:** 807
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/807
- **Branch:** `cursor/tiktok-ad-cover-image`

## Summary

`/ad/create/` rejected every video creative with 40002 "You must upload an image" because we sent `video_id` and no `image_ids`. TikTok's official `AdcreateCreatives` model requires a cover image id. Official `FileImageAdUpload` does **not** document `UPLOAD_BY_VIDEO_ID` (that enum is only on video `AdUploadBody`). Image upload is `UPLOAD_BY_FILE | UPLOAD_BY_URL | UPLOAD_BY_FILE_ID`. We resolve a cover per creative via `UPLOAD_BY_URL` from the persisted thumbnail (or `/file/video/ad/info/` poster), persist `coverImageId` on the draft, and block in preflight when one cannot be resolved.

## Scope / files

- `lib/tiktok/image-upload.ts` — `POST /file/image/ad/upload/` `UPLOAD_BY_URL`
- `lib/tiktok/write/cover-image.ts` — per-creative hydrate + persist
- `lib/tiktok/write/mapping.ts` — `image_ids: [coverImageId]`
- `lib/tiktok/write/launch.ts` — hydrate covers before preflight/writes
- `lib/tiktok/write/ad.ts` — payload log includes `video_id` + `image_ids`
- `lib/types/tiktok-draft.ts` + `migrateTikTokDraft` — `coverImageId`
- Tests for per-creative ids, omitted-key migrate, preflight with zero writes

Did not change video upload transport, identity resolution, killswitch, paused create, rollback, idempotency, name-collision preflight, or Meta.

## Documentation

- Ad creative cover field: https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdcreateCreatives.md (`image_ids`)
- Image upload request model: https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/FileImageAdUpload.md (`UPLOAD_BY_FILE`, `UPLOAD_BY_URL`, `UPLOAD_BY_FILE_ID` — no `UPLOAD_BY_VIDEO_ID`)
- Image upload endpoint: https://ads.tiktok.com/marketing_api/docs?id=1739067433456642
- `UPLOAD_BY_VIDEO_ID` exists only on video upload: https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdUploadBody.md

## Validation

- [x] focused write/migrate/image-upload tests pass
- [x] eslint on changed files clean
- [x] `npm run build` clean (existing Remotion `config` warning only)
- [x] `npm test` — 3990 = 3974 passed + 13 failed + 3 skipped (+8 vs #806's 3982; same 13 pre-existing)

## Notes

`UPLOAD_BY_VIDEO_ID` was not used. It binds an existing video id to an advertiser; it does not mint a cover image.
