# Session log

## PR

- **Number:** 431
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/431
- **Branch:** `cursor/creator/bulk-video-id-input-mode`

## Summary

Adds a "Video IDs" source mode to the bulk video-views audience builder so
users can build audiences from a known list of video IDs without walking
campaigns at all. The campaign-walk path hits the ad-account rate limit
(#80004) at scale; supplying IDs directly bypasses campaign discovery and
only touches Meta's video-object rate bucket (#4, high ceiling) for `from.id`
resolution — dramatically lower risk.

Two ways to populate the video IDs in the new mode:

**(A) Manual paste** — Meta-style textarea, comma/semicolon/newline separated,
live N/50 counter, deduplication.

**(B) "Pull from snapshot cache"** — new
`POST /api/audiences/bulk/video-ids-from-snapshot` endpoint reads
`active_creatives_snapshots` for all events matching the selected prefix
(service-role + ownership-gated). Pre-#429 snapshots: recursive
`$.**.video_id` walk. Post-#429 snapshots: reads `audience_video_sources`
(has `context_page_id` too, so the frontend knows whether it's the richer
shape). Zero Meta calls.

After the user has IDs in the textarea (via either method), "Preview" and
"Create" use the existing `runBulkVideoPreview` / `previewRowsToInserts` /
`createMetaCustomAudience` path unchanged — only the video-discovery phase is
different. `from.id` resolution uses the existing
`hydrateVideoMetadataConcurrent` (50-per-batch, 5-concurrent). Orphan filter
works identically. Event-code dedup is identical.

## Why this beats the existing paths

| Path | Rate-limit exposure |
|---|---|
| Campaign walk | Walk every campaign's ads → #80004 (ad-account) |
| #429 cron-cache | Requires cron to have snapshotted event in new shape |
| **This mode** | Only `/?ids=&fields=from` video-object reads → bucket #4, high ceiling |

## Scope / files

**New files:**
- `lib/audiences/parse-video-ids.ts` — pure parser (comma/semicolon/newline,
  dedupe, ≤50 cap, `totalBeforeCap` for over-limit warning).
- `app/api/audiences/bulk/video-ids-from-snapshot/route.ts` — service-role
  cache-read endpoint; supports both pre-#429 (recursive video_id walk) and
  post-#429 (`audience_video_sources`) snapshot shapes; returns `fetchedAt` +
  `stale` for UI freshness badge.
- `lib/audiences/__tests__/parse-video-ids.test.ts` — 12 unit tests.

**Modified files:**
- `lib/audiences/bulk-video.ts` — `videoIdOverride?: string[]` on
  `RunBulkPreviewOpts`; Phase 0 (snapshot cache) skipped when set; Phase 1
  uses override IDs for every event (no campaign walk), `videoIdMode: true`
  set on walk so `buildRowFromWalk` doesn't skip events with no matched
  campaigns; `skipReason` strings updated for video-ID mode.
- `app/api/audiences/bulk/preview/route.ts` — accepts `videoIds` array in
  body, parses via `parseVideoIds`, guards at 50-ID cap, passes as
  `videoIdOverride` to `runBulkVideoPreview`.
- `app/api/audiences/bulk/create/route.ts` — same.
- `app/(dashboard)/audiences/[clientId]/bulk/bulk-form.tsx` — mode toggle
  ("Campaign walk" / "Video IDs"), textarea with live N/50 counter, "Pull
  from snapshot cache" button with freshness info (`fetchedAt`, stale badge),
  `formatRelative` helper, updated `handlePreview`/`handleCreate`/`handleReset`
  to include `videoIds` in request body when in video-ID mode.

## Constraints honoured

- ✅ `audience-payload.ts` untouched.
- ✅ 5-source split (#427), page-engagement, campaign-walk path, bulk-page
  builder all untouched — additive only.
- ✅ `CREATIVE_BATCH_SIZE` / `AD_INSIGHT_CHUNK_CONCURRENCY` untouched.
- ✅ Video-object batch size ≤50 (uses existing `hydrateVideoMetadataConcurrent`
  with `VIDEO_HYDRATE_BATCH_SIZE = 50`).
- ✅ No migration.
- ✅ Service-role + `userClient → eventIds → serviceClient → snapshots` pattern.
- ✅ Live walk fully intact as fallback (campaign-walk mode unchanged).

## Validation

- [x] Parser: 12 unit tests, 0 fail.
- [x] Full audience suite: 189 tests, 0 fail (up 12 from parser tests).
- [x] `npm run lint` — no new issues on changed files.
- [x] `npm run build` — passes.

## Notes

**Rate-bucket analysis.** `hydrateVideoMetadataConcurrent` calls
`GET /?ids=V1,V2,...&fields=from` — this is a video object read, not a
campaign/ad/insights call. Meta classifies it under the general Graph API
app-level bucket (#4), not the ad-account bucket (#80004). Observed limit
is ~600 calls/hour at the app level vs. 40 calls/hour per-account for
insights. For ≤50 IDs input cap, worst case is 1 batched Graph call per
preview — orders of magnitude under any rate limit.

**`videoIdMode` flag purpose.** In campaign-walk mode, "no matched campaigns"
means "nothing to walk → skip this event". In video-ID mode the user is
providing IDs directly, so no matched campaigns is fine — the audiences
still cover that event. The `videoIdMode: boolean` field on `EventWalk`
propagates this distinction to `buildRowFromWalk` cleanly without changing
the skip logic for campaign-walk mode.

**Pull-from-cache returns `contextSources: null | Array`.**
When the snapshot is pre-#429 shape, only `videoIds` are returned (no
`contextPageId`). The frontend currently ignores this field — it just fills
the textarea with the IDs. A future enhancement could pass `contextSources`
back to the backend alongside `videoIds` to skip the `from.id` resolution
for post-#429 snapshots (saving 1 batch Meta call for cache-pulled IDs).
Intentionally out of scope for this PR.
