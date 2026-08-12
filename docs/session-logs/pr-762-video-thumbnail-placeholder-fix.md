# Session log: motion ad thumbnails were Meta's loading-spinner GIF (task #128)

## PR

- **Number:** 762
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/762
- **Branch:** `cursor/video-thumbnail-placeholder-fix`

## Summary

Every motion (video) ad shipped since PR #748 could ship with Meta's own
"still encoding" loading-spinner GIF as its still frame instead of a real
video frame. Reproducer: IPC – Motion 1 (draft
`faf11b6f-bf7f-4ad8-9f4e-61bae0e2261c`, creative
`6e168e8b-505f-4d8a-9b7a-2b19a91b1728`) had `thumbnailUrl` =
`https://static.xx.fbcdn.net/rsrc.php/v4/yN/r/AAqMW82PqGg.gif` — Facebook's
internal UI-resource CDN (`static.xx.fbcdn.net/rsrc.php/`), never user
content (user media is always on `scontent*.xx.fbcdn.net`).

**Root cause:** `fetchVideoThumbnailWithRetry` polled `GET
/{videoId}?fields=picture` only twice, 3s apart (6s total). While a video is
still encoding, Meta doesn't omit `picture` or return null for that window —
it returns the spinner GIF's URL, a genuinely non-empty string, which the
original `if (typeof data.picture === "string" && data.picture)` check
happily accepted. Meta's docs put video-encoding p95 at ~45s for HD and ~90s
for 4K, so the original 6s budget missed the vast majority of encodes, not
an edge case. PR #748 then started uploading whatever `picture` came back as
`video_data.image_hash` — so the spinner got baked into the ad creative
itself.

## Scope / files

- `lib/meta/video-thumbnail-poll.ts`:
  - New `isMetaPlaceholderThumbnailUrl(url)` — flags any `rsrc.php` URL on a
    `static`/`www` `*.fbcdn.net` host, plus the specific known spinner
    filename fragment `AAqMW82PqGg` (belt-and-braces in case Meta ever moves
    it to a different path). `fetchVideoThumbnailWithRetry` now treats a
    placeholder hit exactly like "picture not ready" and keeps polling.
  - Polling schedule changed from `[3000, 3000]` (2 attempts / 6s) to the new
    `DEFAULT_POLL_DELAYS_MS` = `[3000, 5000, 8000, 12000, 20000]` (5
    attempts / 48s total) — catches Meta's documented ~45s p95 for HD. The
    third parameter changed shape from a single `_pollDelayMs: number` to an
    array `_pollDelaysMs: readonly number[]`, still injectable for tests.
  - If the full 48s budget exhausts with only placeholders/absence, still
    returns `""` (unchanged contract) — `resolveVideoThumbnailHash` /
    `buildVideoCreative` in `lib/meta/creative.ts` already omit both
    `image_hash`/`image_url` in that case and let Meta auto-generate a
    thumbnail at ad-creation time, so the spinner is never shipped even on
    the residual tail.
- `lib/meta/client.ts` — updated the `uploadVideoAsset` comment above the
  `fetchVideoThumbnailWithRetry` call to describe the new budget/placeholder
  rejection (behavior itself unchanged — the route's `maxDuration=300`
  comfortably covers the new 48s worst case).
- `scripts/repair-video-thumbnails.mjs` (new) — one-off retroactive repair
  for ads that already shipped with the spinner baked in:
  1. Loads published `campaign_drafts` from the last `--days` window
     (default 90), sorted so the user-reported campaigns (EED Newcastle v2,
     IPC Newcastle v3, Colyn Wide, Nora En Pure, Booka Shade, Mall Grab,
     Parable) are processed first.
  2. Finds every video creative whose primary asset (mirrors
     `pickPrimaryVideoAsset`'s `VIDEO_PRIORITY` selection in
     `lib/meta/creative.ts`) has a placeholder `thumbnailUrl`, deduped by
     Meta creative id (a creative shared across ad sets is repaired once).
  3. Per creative: re-fetches `GET /{videoId}?fields=picture` (Meta has
     usually finished encoding by now), uploads it via `/adimages`, fetches
     the creative's current `object_story_spec` and splices in the new
     `image_hash` (preserving every other field), POSTs it back, then
     best-effort patches the matching asset's `thumbnailUrl`/`assetHash` in
     our own `campaign_drafts.draft_json` so future re-reads don't
     resurrect the placeholder.
  4. **Dry run by default** — pass `--live` to actually write. Rate-limited
     to 1 creative/sec. Resumable via a local JSON checkpoint file
     (`scripts/.repair-video-thumbnails-checkpoint.json`, gitignored) keyed
     by Meta creative id, so a crash/Ctrl-C + re-run skips anything already
     fixed.
  - `isMetaPlaceholderThumbnailUrl` is duplicated inline in this plain
    `.mjs` script (same convention as `scripts/backfill-key-moments.mjs`
    mirroring `lib/db/event-key-moments.ts`) rather than importing the `.ts`
    module, to avoid a TS loader dependency for a one-off script.
- Tests:
  - `lib/meta/__tests__/upload-video-thumbnail.test.ts` — rewritten: new
    `isMetaPlaceholderThumbnailUrl` describe block (spinner URL, generic
    `rsrc.php` URLs on `static`/`www` hosts, the filename fragment under a
    different path, real `scontent` URLs, arbitrary non-fbcdn URLs, empty
    string); `fetchVideoThumbnailWithRetry` tests updated for the 5-attempt
    budget, plus new cases: polls through a placeholder→placeholder→real
    sequence and returns the real thumbnail; regression — returns `""`
    after exhausting all 5 attempts when every response is a placeholder;
    distinct log line for placeholder detection vs a plain miss;
    `DEFAULT_POLL_DELAYS_MS` shape/total sanity check.
- `.gitignore` — added the repair script's checkpoint file.

## Validation

- [x] `npx tsc --noEmit` — 370 pre-existing errors, identical set before/after (diffed).
- [x] `npm run build` — succeeds.
- [x] `npm test` — 3631 tests, 3615 pass, 13 fail; all 13 are the same
      pre-existing failures as baseline (dashboard/`@/lib` alias resolution,
      asset-queue, creative-buy-tickets-cta) — none touch the files this PR
      modifies.
- [x] `npm run lint` — 272 problems (54 errors / 218 warnings), identical
      count to baseline; zero lint issues in any file touched by this PR.
- [x] `node --check scripts/repair-video-thumbnails.mjs` — syntax valid.

## Notes

- `scripts/repair-video-thumbnails.mjs` has not been run against production
  data as part of this PR (no Meta/Supabase credentials available in this
  environment) — it should be run dry-run-first by an operator with
  `META_ACCESS_TOKEN` configured, reviewed, then re-run with `--live`.
- **Follow-up flagged as task #129 (separate PR, not implemented here):**
  the wizard should enforce uploading a 4:5 or 1:1 asset alongside 9:16 for
  any video creative launched to Feed placement, or auto-generate a
  letterboxed square. Today a video with only a 9:16 asset gets
  cross-published to Feed as a thin centred strip on black, which kills Feed
  performance regardless of thumbnail quality. Reproducer: draft `faf11b6f`,
  creative `6e168e8b`'s asset array has only `aspectRatio: "9:16"`.
