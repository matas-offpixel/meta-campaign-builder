# Session log — fix video creative thumbnail

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/fix-video-creative-thumbnail`

## Root cause

`buildVideoCreative` in `lib/meta/creative.ts` built `video_data` without `image_url` or `image_hash`. Meta requires one of them and rejects with `code=100 · subcode=1443226 · "Please specify one of image_hash or image_url in the video_data field of object_story_spec."` Surfaced on two consecutive launches (Deep House Bible, Junction 2 Melodic).

## Fix (2 files changed)

### `lib/meta/creative.ts`

- Added `image_url?: string` to the `MetaVideoData` interface with a docstring explaining why it's required.
- Added `pickPrimaryVideoAsset()` helper that returns `{ videoId, thumbnailUrl }` from the same asset, so thumbnail is always paired with its video (no cross-slot mismatch in multi-ratio drafts).
- Deprecated `pickPrimaryVideoId()` (still used internally via the new helper — no caller breakage).
- `buildVideoCreative` now:
  - Uses `pickPrimaryVideoAsset` to get both `videoId` and `thumbnailUrl` together.
  - Sets `videoData.image_url = thumbnailUrl` when present.
  - Gracefully omits `image_url` when `thumbnailUrl` is undefined (old drafts pre-upload re-run) instead of throwing — fail-safe, not fail-hard.
  - Logs `console.error("[buildVideoCreative] videoId=X thumbnail=Y")` on every call.
  - Logs `console.error("[buildVideoCreative] WARNING: no image_url set…")` when no thumbnail is present, so future drift surfaces in Vercel logs.

### `lib/meta/__tests__/creative-video-thumbnail.test.ts` (new)

4 tests:
1. `image_url` is set when `thumbnailUrl` is present
2. `image_url` is omitted (no throw) when `thumbnailUrl` is missing — old-draft backward compat
3. `video_id` is still set correctly alongside `image_url`
4. Multi-ratio draft: 9:16 thumbnail matches 9:16 video (VIDEO_PRIORITY respected)

## Not changed

- `uploadVideoAsset` (upload flow) — `thumbnailUrl` was already being stored
- `buildLinkCreative` — image ads already work
- Any other caller of `buildCreativePayload`

## Validation

- [x] `npx tsc --noEmit` — no new errors
- [x] 42/42 tests pass
- [ ] Manual: re-run Junction 2 Melodic bulk-attach; confirm all video creatives succeed
- [ ] Check Vercel logs for `[buildVideoCreative] videoId=… thumbnail=https://…`
- [ ] Squash-merge after Vercel preview green
