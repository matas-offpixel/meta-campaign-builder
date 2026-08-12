# Session log

## PR

- **Number:** 767
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/767
- **Branch:** `cursor/thumbnails-via-thumb-offset`

## Summary

Task #128 continued. Motion-ad thumbnails were still broken after PR #762 (poll
fix) and PR #765/#766 (repair-script detection + write-auth fixes): the LIVE
launch path's own `uploadImageFromUrl` (`POST /adimages`) — used since PR #748
to mint a Duplicate-safe `image_hash` for `video_data` — fails every call with
Meta code=3 "Application does not have the capability", regardless of token
(PR #766 already ruled out "wrong token" as the cause). The app is stuck in
App Review (task #90) and escaping it is a weeks-long unblock, so this PR
bypasses `/adimages` entirely for video thumbnails instead of waiting on it.

**FIX 1 (primary):** `uploadVideoAsset` (`lib/meta/client.ts`) now always
passes `thumb_offset` (default 1000ms — avoids a black first frame) to
`POST /{adAccountId}/advideos`. That's a video-UPLOAD-time parameter on a
different Graph edge with its own (working) capability grant — Meta then
serves that exact frame as the video object's own canonical thumbnail
forever after (`GET /{videoId}?fields=picture`), no ad-account image write
needed. `buildVideoCreative` / `buildSingleAssetFromVertical`
(`lib/meta/creative.ts`) were changed to match: they no longer call
`uploadImageFromUrl` at all, and never set `video_data.image_hash` or
`image_url` — Meta renders the thumb_offset frame at ad-serving time. This
also fixes task #603 (bulk-attach video creatives failing with
subcode=1443226 "missing image_hash/image_url") as a side effect — neither
field is required once thumb_offset is set — and makes task #112's
Duplicate-flow bug (subcode=1443051) structurally impossible, since neither
field is ever populated for Duplicate to copy.

**FIX 2 (fallback for edge cases):** added `uploadVideoThumbnail`
(`POST /{videoId}/thumbnails`, `is_preferred=true`) — a video-OBJECT write on
a different edge than `/adimages`, unconfirmed against this app's live App
Review status. Wired through a new API route and a client-side frame
extractor (`<video>` + `<canvas>`, no upload round-trip needed to preview).
The Creatives step's `AssetSlot` now shows a "Pick thumbnail frame" control
on uploaded video assets: scrub the real local video, "Use this frame"
extracts + POSTs it as an override. A failure here is always non-fatal —
FIX 1's thumb_offset thumbnail already renders correctly regardless, so this
is best-effort polish surfaced as an inline error, never a launch blocker.

## Scope / files

- `lib/meta/video-upload-request.ts` (new) — pure request-field builders
  (`buildVideoUploadFields` for `thumb_offset` + filename/title sanitisation,
  `buildVideoThumbnailOverrideRequest` for the FIX 2 path). Lives outside
  `client.ts` (parameter-property `MetaApiError` breaks
  `--experimental-strip-types`) so tests can byte-diff the built fields
  without a live Meta call — same pattern as
  `business-manager-grant-request.ts`.
- `lib/meta/client.ts` — `uploadVideoAsset` gains `UploadVideoAssetOptions`
  (`thumbOffsetMs`, default 1000ms) and always sends `thumb_offset`; new
  `uploadVideoThumbnail` (FIX 2, `POST /{videoId}/thumbnails`).
- `lib/meta/creative.ts` — `buildVideoCreative` / `buildSingleAssetFromVertical`
  no longer call any thumbnail-upload helper and never set
  `video_data.image_hash`/`image_url`; removed the now-dead
  `ThumbnailUploader` type, `resolveVideoThumbnailHash`, and
  `metaAdAccountId`/`metaAccessToken`/`uploadThumbnailAsImage` from
  `BuildCreativePayloadOpts` (only `validatedIgActorId` remains).
- `app/api/meta/launch-campaign/route.ts`, `bulk-attach-ads/route.ts`,
  `create-creatives-and-ads/route.ts` (×2 call sites) — stopped passing the
  removed opts / importing `uploadImageFromUrl` into `buildCreativePayload`.
- `app/api/meta/upload-video-thumbnail/route.ts` (new) — FIX 2's route:
  resolves the operator's Meta token, calls `uploadVideoThumbnail`, never
  treated as launch-blocking by callers.
- `lib/meta/video-frame-extract.ts` (new) — browser-only frame extraction
  (`extractVideoFrameFromUrl` for an already-live blob URL,
  `extractVideoFrame` wrapper for a raw `File`); `clampSeekTarget` factored
  out pure for unit coverage without a DOM.
- `components/steps/creatives.tsx` — `AssetSlot` gained the FIX 2 picker UI
  (scrub the existing local video preview, "Use this frame" / "Cancel",
  inline error on failure, "Custom thumbnail set" footer indicator).
- `lib/meta/__tests__/video-upload-request.test.ts`,
  `video-frame-extract.test.ts` (new) — full coverage of the new pure
  builders/helpers.
- `lib/meta/__tests__/creative-video-thumbnail.test.ts` — rewritten: asserts
  `video_data` NEVER carries `image_hash`/`image_url`, even when a real
  `thumbnailUrl` is present.
- `lib/meta/__tests__/creative-multi-placement.test.ts` — one BOOK_NOW/dual
  video assertion updated to match the new no-thumbnail-field behaviour.
- `lib/meta/__tests__/video-thumbnail-cache-guard.test.ts` — added
  `lib/meta/video-upload-request.ts` to the allow-list; its `POST` override
  path matches the guard's `/{video_id}/thumbnails` regex but is an
  unrelated write path, not the read-dedup concern the guard protects.

## Validation

- [x] `npx tsc --noEmit` — 370 errors vs. 371 on the pre-change baseline (one
  fewer; no new errors introduced, confirmed via `git stash` diff)
- [x] `npx eslint` on every touched/new file — 0 errors; only pre-existing
  warnings (unchanged from baseline, confirmed via `git stash` diff)
- [x] `node --test` full suite — 3774 tests, 13 failures, all pre-existing on
  `main` (confirmed via `git stash` diff of failing-test names); the
  `video-thumbnail-cache-guard` false positive this PR introduced was fixed
  by allow-listing the new file, not by suppressing the check
- [x] `npm run build` — succeeds; new `/api/meta/upload-video-thumbnail`
  route appears in the route manifest
- [ ] Live test: launch a video ad via the wizard → confirm the ad's
  thumbnail on Meta (Ads Manager or `GET /{videoId}?fields=picture`) is a
  real frame at ~1s in, not the spinner GIF, with zero `/adimages` calls in
  the server logs for that launch
- [ ] Live test: FIX 2's "Pick thumbnail frame" → confirm whether
  `POST /{videoId}/thumbnails` is actually permitted under this app's App
  Review status (unconfirmed, per its own doc comments) — if it also 403s
  with code=3, the UI already degrades gracefully (inline error, no launch
  impact) but is effectively dead until/unless that capability is granted

## Notes

- Regression risk is low and one-directional: video creatives now send
  *fewer* fields (no `image_hash`/`image_url`) than before, and the one
  Meta-side behaviour this depends on (thumb_offset producing a real,
  servable video thumbnail) is a documented, long-standing Graph API
  feature — independent of this app's App Review status because it's a
  video-upload parameter, not an ad-account image write.
- `uploadImageFromUrl` (`lib/meta/client.ts`) is untouched and still
  exported — `scripts/repair-video-thumbnails.mjs` (task #128's retroactive
  repair script) still uses it for already-launched, already-broken
  creatives. Whether that repair path also silently fails under the same
  code=3 restriction is a separate, already-flagged, not-yet-answered
  question (PR #766's live-token fix assumed "wrong token", which this PR's
  root-cause investigation shows insufficient — that script's live run
  needs re-verification, follow-up candidate, not fixed here).
- Follow-up candidate (not done here): once thumb_offset-based launches are
  live for a while, consider whether `Asset.thumbnailUrl` (still populated
  by `fetchVideoThumbnailWithRetry` purely for the wizard's own upload-time
  preview) needs any changes — it's unrelated to what gets sent to Meta's
  creative payload after this fix and already works correctly per PR #762.
- FIX 2's UI never blocks: a `POST /{videoId}/thumbnails` failure only
  disables that one asset's override for the session (inline error,
  "Cancel" still works) — creative launch always relies on FIX 1's
  thumb_offset thumbnail regardless of whether FIX 2 succeeded.
