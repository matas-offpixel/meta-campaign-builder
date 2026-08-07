# Session log

## PR

- **Number:** 748
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/748
- **Branch:** `cursor/video-creative-image-hash`

## Summary

Fixes task #112: video ads launched by our code fail Meta UI's Duplicate flow
with code=100 subcode=1443051 ("ObjectStorySpecRedundant: Only one of
image_url and image_hash should be specified in the field video_data").

**Diagnostic trail:** `buildVideoCreative` sent `video_data.image_url` set to
the Meta-CDN thumbnail URL returned by `POST /advideos` (task #68's fix).
Meta's write-side validator accepts this at create time — but Meta then
fetches that URL itself and stores an internally-generated `image_hash`
**alongside** the `image_url` on the creative. When the operator uses Meta
UI's Duplicate action, Meta copies **both** fields into the new creative's
payload, and Meta's *stricter* write-side validator on the Duplicate action
rejects with subcode=1443051. Static/link ads never hit this because
`buildLinkCreative` already sends `image_hash` exclusively — video was the
only path still using `image_url`.

**Fix:** upload the thumbnail ourselves via a new `uploadImageFromUrl` helper
(`POST /act_{id}/adimages` with the CDN URL — Meta fetches the bytes
server-side, no download+re-upload needed) and send only `image_hash` in
`video_data`, never `image_url`. Applied to both video creative paths:
`buildVideoCreative` and the video branch of `buildSingleAssetFromVertical`
(the BOOK_NOW single-asset-vertical fallback). Falls back to `image_url`
(pre-#112 behaviour) when no ad account/token is available or the upload
fails — this never regresses #68's subcode=1443226 (missing both fields).

Verified `buildVariationRotationCreative`'s `asset_feed_spec.videos[].thumbnail_url`
is a different Meta field with no hash-equivalent sibling (`AssetFeedVideo`
interface only has `thumbnail_url` + `adlabels`) — left untouched, no
duplicate-field trap there.

## Scope / files

- `lib/meta/client.ts` — new `uploadImageFromUrl(adAccountId, imageUrl, token)`
- `lib/meta/creative.ts` — `buildVideoCreative` + `buildSingleAssetFromVertical`
  now `async`; new `resolveVideoThumbnailHash` helper; `uploadThumbnailAsImage`
  injected via `BuildCreativePayloadOpts` (kept `creative.ts` API-call-free per
  its file header — the uploader is injected, not imported, since
  `client.ts` uses TS parameter-property syntax the test runner's
  `--experimental-strip-types` can't parse)
- `app/api/meta/create-creatives-and-ads/route.ts`,
  `app/api/meta/bulk-attach-ads/route.ts`, `app/api/meta/launch-campaign/route.ts`
  — pass `metaAdAccountId` / `metaAccessToken` / `uploadThumbnailAsImage:
  uploadImageFromUrl` into `buildCreativePayload`; all three call sites now
  `await` it (cascaded from making the video paths async)
- `lib/meta/__tests__/creative-video-thumbnail.test.ts` — rewritten to assert
  `image_hash` set / `image_url` absent, plus fallback-path coverage
  (missing ad account, upload failure)
- `lib/meta/__tests__/creative-multi-placement.test.ts`,
  `creative-ig-identity-regression.test.ts`, `creative-buy-tickets-cta.test.ts`,
  `creative-variation-rotation.test.ts`, `ig-picker-safety.test.ts` — mechanical
  `async`/`await` updates for the now-async `buildCreativePayload`

## Validation

- [x] `npx tsc --noEmit` — no new errors (baseline pre-existing errors unchanged,
  confirmed by diffing tsc output against a `git stash` of `main`)
- [x] `npx eslint` on all touched files — no new warnings/errors
- [x] `node --test lib/meta/__tests__/*.test.ts` — 298/299 pass; the 1 failure
  (`creative-buy-tickets-cta.test.ts` rotation-path assertion) reproduces
  identically on unmodified `main` — pre-existing, unrelated to this change
- [ ] Live test: launch a video ad via the wizard, then Duplicate in Meta Ads
  Manager UI — expect success (no subcode=1443051). Compare against a
  pre-fix ad, which should still fail Duplicate (proves the fix, not a
  Meta-side change).

## Notes

- Regression risk: adds one Meta API call (`POST /adimages`) per video ad
  launch. Accepted — video launches are already the most API-heavy path.
- Related: #68 (mirror bug, subcode=1443226, missing both fields — this fix
  does not regress it since `image_hash` is set unconditionally whenever
  `thumbnailUrl` is present and the upload succeeds).
- Follow-up candidate (not done here): if Meta's Duplicate flow on
  `asset_feed_spec`-based creatives (variation rotation / multi-placement)
  ever surfaces an analogous "both fields" bug, investigate
  `asset_customization_rules` similarly — but `AssetFeedVideo` has no
  hash-equivalent field today, so there is currently no known trap there.
