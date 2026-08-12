# Session log template

## PR

- **Number:** 765
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/765
- **Branch:** `cursor/repair-detection-image-fingerprint`

## Summary

Task #128 continued: PR #764's dry run against 7 explicitly-targeted, known-affected campaigns (338+ post-#748 ads) found **zero** broken creatives, even though a known-broken creative ("IPC Motion 1", draft `faf11b6f` / creative `6e168e8b`) demonstrably ships the spinner GIF. Root cause: once PR #748 uploads the spinner via `POST /adimages` to mint an `image_hash`, that hash resolves to an ad-account-scoped `scontent*.fbcdn.net` URL forever after — `isMetaPlaceholderThumbnailUrl` (a URL/host classifier, correct for the LIVE pre-upload `GET /{videoId}?fields=picture` response) structurally cannot fire on it. Fixed by classifying the **resolved image itself** instead of its URL: `isMetaPlaceholderThumbnailImage` fingerprints width/height (spinner is ≤32×32), file extension/name (`.gif`, known spinner filename fragment), and — when those don't already settle it — a HEAD-derived `content-length` (spinner is <5KB; real thumbnails are 15-50KB JPGs). Also added a `--diagnose-hash=<hash> --ad-account=<id>` script mode to sanity-check a single hash's resolved fingerprint against the classifier without running a full scan.

## Scope / files

- `lib/meta/video-thumbnail-poll.ts` — new `isMetaPlaceholderThumbnailImage` + `MetaAdImageFingerprint` type, `SPINNER_MAX_DIMENSION_PX` / `SPINNER_MAX_CONTENT_LENGTH_BYTES` constants. `isMetaPlaceholderThumbnailUrl` untouched (still correct for its live-polling job).
- `lib/meta/video-thumbnail-repair-scan.ts` — `resolveImageHashUrl` → `resolveImageHashMetadata` (requests `width,height,name` alongside `url`); new `fetchContentLength` (rate-limited HEAD fallback); `scanCampaignForBrokenVideoAds` and `findBrokenVideoAds` now classify via the resolved fingerprint, only paying for the extra HEAD round-trip when metadata alone doesn't settle it.
- `scripts/repair-video-thumbnails.mjs` — mirrors the same fingerprint classifier + `resolveImageHashMetadata`/`fetchContentLength` inline; new `--diagnose-hash=<hash> --ad-account=<id>` CLI mode (prints resolved metadata + HEAD content-length + classifier verdict, zero discovery/repair/writes).
- Tests: `lib/meta/__tests__/upload-video-thumbnail.test.ts` (new `isMetaPlaceholderThumbnailImage` describe block, including the exact broken/fine fixtures from the task spec), `lib/meta/__tests__/video-thumbnail-repair-scan.test.ts` (rewritten `resolveImageHashMetadata`/new `fetchContentLength` describes, end-to-end scan tests updated to mock the metadata + HEAD pipeline, including a dedicated "flags via HEAD content-length alone" case).

## Validation

- [x] `npx tsc --noEmit` (no new errors vs. baseline)
- [x] `npm run build`
- [x] `node --experimental-strip-types --test lib/meta/__tests__/upload-video-thumbnail.test.ts lib/meta/__tests__/video-thumbnail-repair-scan.test.ts` (all pass; 1 pre-existing unrelated failure elsewhere in `lib/meta/__tests__` confirmed present on `main` too)
- [x] `eslint` on all changed files — clean
- [x] Manual smoke test of `--diagnose-hash` against mocked broken + fine responses — verdicts correct

## Notes

- `isMetaPlaceholderThumbnailUrl` is deliberately left untouched — it's still the correct check for the LIVE pre-upload polling path in `fetchVideoThumbnailWithRetry` / `repairOne`'s re-fetch-then-verify step, where the URL genuinely is still on Meta's static UI CDN. The new `isMetaPlaceholderThumbnailImage` is a second, independent classifier for the POST-upload `/adimages`-resolved state, where the URL no longer carries any signal.
- Operators should run `--diagnose-hash=<IPC Motion 1's image_hash> --ad-account=<id>` once against real Meta before trusting a full re-run, per the task's request.
