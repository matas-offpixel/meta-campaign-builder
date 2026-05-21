# Session log — Video-views 200-video cap: chunk-and-sibling split

## PR

- **Number:** 441
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/441
- **Branch:** `cursor/creator/video-views-200-cap-split`

## Problem

Video-views audiences fail with:
> `(#2654) Video engagement audience too big: contains N videos, maximum limit is 200 (subcode 1870231)`

when the source set exceeds 200 videos. Confirmed live 2026-05-21: P26-OPENAIR
(Puzzle) has 206 videos — all 4 funnel cells failed. The UI showed the generic
"Meta audience id missing after write" because the real error was being swallowed
(same masking as the page-engagement work in PR #427).

This is the video-views equivalent of the page-engagement 5-source cap (PR #427).

## Changes

### `lib/meta/audience-payload.ts`

- Added `MAX_VIDEO_VIEWS_VIDEOS = 200` constant (documented with Meta's error
  code and live failure context).
- Extracted a private `chunkIds(ids, size)` generic chunker; both `chunkPageIds`
  and the new `chunkVideoIds` delegate to it (eliminates logic duplication).
- Added `export function chunkVideoIds(videoIds, size = MAX_VIDEO_VIEWS_VIDEOS)`
  — same interface as `chunkPageIds` but defaulting to the video cap.

### `lib/meta/audience-write.ts`

**New helpers (private):**
- `videoViewVideoIds(audience)` — extracts `sourceMeta.videoIds` safely
  (analogous to `pageEngagementPageIds`).
- `withVideoIds(audience, videoIds)` — shallow clone with `videoIds` narrowed to
  a chunk (analogous to `withPageIds`).
- `videoSplitPartSourceMeta(parentMeta, chunk, markers)` — builds split-part
  `sourceMeta` with `videoIds` replaced + `splitPart`/`splitTotal`/`splitParentId`
  markers (analogous to `splitPartSourceMeta` for page engagement).
- `writeSplitVideoViews(args)` — mirrors `writeSplitPageEngagement` exactly:
  two-phase write (all Meta creates first → idempotent per part, then sibling
  DB rows → find-or-create by `splitParentId`, primary row last). Returns the
  primary (part 1) row.

**Gate in `createMetaCustomAudience`:**
- After the CHUNKABLE_SUBTYPES page-split gate, added a `video_views` split gate:
  extracts `videoIds` from the audience and routes to `writeSplitVideoViews` when
  `videoIds.length > MAX_VIDEO_VIEWS_VIDEOS`. For ≤200 videos the existing single
  `buildMetaCustomAudiencePayload` + `createOneMetaAudience` path is unchanged.

**Error surfacing in `createMetaCustomAudienceBatch`:**
- Changed `throw new Error("Meta audience id missing after write")` to
  `throw new Error(updated.statusError ?? "Meta audience id missing after write")`.
- `createMetaCustomAudience` catches Meta errors internally and stores the real
  error in `statusError` on the failed row. The batch function was masking this
  with the generic placeholder. Now it surfaces the actual Meta message (e.g.
  `"(#2654) Video engagement audience too big…"`).

### `lib/meta/__tests__/audience-write.test.ts`

- Imported `chunkVideoIds`, `MAX_VIDEO_VIEWS_VIDEOS`.
- New describe block "chunkVideoIds (Meta 200-video cap)" — 5 tests:
  - `MAX_VIDEO_VIEWS_VIDEOS is 200`
  - `splits 206 videos into 200 + 6` (the live P26-OPENAIR case)
  - `leaves ≤200 videos as a single chunk (no regression)`
  - `splits 401 videos into 200 + 200 + 1`
  - `throws on a non-positive chunk size`
  - `builds the two part payloads for a 206-video audience: 200 + 6 rule entries each`
    — verifies payload rule array lengths, `event_name`, `context_id`, and
    `(1 of 2)` / `(2 of 2)` suffixes in the sanitized name.

## Validation

- [x] `npm run build` — green (no type errors).
- [x] `node --experimental-strip-types --test lib/meta/__tests__/audience-write.test.ts`
  — **41/41 pass** (7 new video-cap tests + all existing tests).
- [x] `npm run lint` — no new errors.

## Notes

- The video-views rule shape (bare JSON array, NOT `{inclusions:{...}}`) is
  preserved per chunk — `buildMetaCustomAudiencePayload` remains unchanged.
- `contextId`, `threshold`, and `retentionDays` carry over to every sibling
  chunk unchanged; only `videoIds` is narrowed to the chunk subset.
- The split pattern is identical to PR #427 (page engagement). Sibling rows
  are find-or-created on retry via `splitParentId`, so mid-way failures are
  safe to retry.
- To fix P26-OPENAIR: set those 4 failed audience rows back to `draft` and
  re-trigger creation — the new split logic will handle the 206 videos cleanly.
