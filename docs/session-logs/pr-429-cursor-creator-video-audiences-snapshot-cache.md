# Session log

## PR

- **Number:** 429
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/429
- **Branch:** `cursor/creator/video-audiences-snapshot-cache`

## Summary

Two-part change to make the bulk video-views audience builder serve from
the cron-populated `active_creatives_snapshots` cache instead of walking
every event's campaign tree live on each preview/create. Live walks
repeatedly tripped Meta rate limits (#80004 ad-account, #17 user) at
scale (WC26 61 events, Junction 2 high-spend) and were the primary
ratchet on audience builder reliability.

Part 1 — **writer**: extend `lib/reporting/active-creatives-fetch.ts` to
collect `(video_id, context_page_id)` pairs during creative hydration
using the same multi-shape extraction PR #391 added to
`walkCampaignAds` (object_story_spec.page_id → platform_customizations
→ asset_feed_spec.page_ids[]). Adds `platform_customizations` to
`CREATIVE_BATCH_FIELDS` (one extra field on an already-paid call — no
fan-out increase, `CREATIVE_BATCH_SIZE` stays at 25,
`AD_INSIGHT_CHUNK_CONCURRENCY` stays at 1). Pairs are persisted inside
the existing snapshot `payload` jsonb as
`audience_video_sources: Array<{ video_id, context_page_id }>` —
no migration, no DB schema change. Writer's
`kind:"skip"|"error"` refusal contract preserved by design (the new
field only lives on the `ok` branch).

Part 2 — **reader**: new `getVideoSourcesFromSnapshot(admin, eventIds)`
service-role resolver in `lib/audiences/snapshot-video-sources.ts`. Per
event, returns `hit | miss(no_snapshot | no_audience_sources)`. Wired
into `runBulkVideoPreview` as Phase 0: cache-hit events skip the live
campaign walk AND skip Phase 2's `hydrateVideoMetadataConcurrent`
entirely (writer guarantees every persisted pair has a resolved Page).
Cache-miss / stale-build-version / pre-Part-1 events fall back to the
live walk for THAT event only — per-event granularity so one stale
event can't drag the whole batch back onto Meta. Build-version
invalidation defers to the existing `readActiveCreativesSnapshot`
helper (mig 067 deploy invalidation pattern).

UI: new per-row `source: "cache" | "cache_stale" | "live"` badge on the
preview card so Matas can see at a glance which events served from
cache and which still hit Meta.

**Timing**: Part 1 only populates `audience_video_sources` on snapshots
written AFTER this deploys. Existing rows lack it, so every event
falls back to live walk until the next cron cycle (≤6h) refreshes the
shape. Full cache benefit (zero per-build Meta walk-traffic for
cron-seen campaigns) kicks in after one cron cycle post-merge.

## Scope / files

**Part 1 — writer (snapshot payload extension)**

- `lib/audiences/extract-page-ids-from-creative.ts` (new) — pure helper
  for the three-shape page-id extraction; mirrors PR #391 logic from
  `walkCampaignAds`.
- `lib/reporting/active-creatives-fetch.ts` — adds
  `platform_customizations` field, exports `AudienceVideoSource`,
  collects pairs in the per-ad hydration loop, attaches
  `audience_video_sources` on `FetchActiveCreativesResult`.
- `lib/reporting/share-active-creatives.ts` — forwards
  `audience_video_sources` through onto the `ShareActiveCreativesResult`
  OK branch (additive optional field, ignored by every other consumer).

**Part 2 — reader (cache-first audience builder)**

- `lib/audiences/snapshot-video-sources.ts` (new) — service-role
  resolver; per-event hit/miss classification; defers build-version
  invalidation to `readActiveCreativesSnapshot`.
- `lib/audiences/bulk-types.ts` — adds `BulkPreviewSource` union and
  optional `source` on `BulkPreviewRow`.
- `lib/audiences/bulk-video.ts` — new Phase 0 cache classification +
  per-event fallback; Phase 2 only runs for live-walk events;
  `buildRowFromWalk` extracted as a helper.
- `app/api/audiences/bulk/preview/route.ts` — wires
  `getVideoSourcesFromSnapshot(createServiceRoleClient(), eventIds)`
  through the `userClient → eventIds → serviceClient → snapshots`
  pattern.
- `app/api/audiences/bulk/create/route.ts` — same.
- `app/(dashboard)/audiences/[clientId]/bulk/bulk-form.tsx` — adds
  `PreviewSourceBadge` (cache / cache stale / live walk) to each
  preview event card.

**Tests**

- `lib/audiences/__tests__/extract-page-ids-from-creative.test.ts`
  (new) — 10 unit tests covering OSS / platform_customizations /
  asset_feed_spec + combined shapes + edge cases (null page_ids,
  non-string values, ignored platforms).
- `lib/audiences/__tests__/snapshot-video-sources.test.ts` (new) — 11
  unit tests covering cache hit / stale (is_stale flag OR past
  expires_at) / cache miss (null row, build_version mismatch,
  pre-Part-1 no audience_video_sources, empty audience_video_sources,
  skip/error discriminant) / mixed batch / per-eventId filtering at
  date_preset=maximum.
- `lib/reporting/__tests__/active-creatives-refresh-runner.test.ts`
  — adds regression test "forwards audience_video_sources into the
  snapshot payload" so the runner → writer round-trip is locked in.

## Validation

- [x] `npx tsc --noEmit -p tsconfig.json` — zero new errors on changed
  files (pre-existing errors in unrelated test files unchanged).
- [x] `npm run lint` — zero issues on changed files (pre-existing
  warnings in `useMeta.ts` / `interest-suggestions.ts` /
  `optimisation-rules.ts` unchanged).
- [x] `npm run build` — production build passes.
- [x] `node --experimental-strip-types --test lib/audiences/__tests__/`
  (excluding pre-existing-broken `batch-fetch-video-metadata.test.ts`)
  — 175 tests pass / 0 fail.
- [x] `node --experimental-strip-types --test lib/db/__tests__/` — 228
  tests pass (1 pre-existing skip).
- [x] `node --experimental-strip-types --test lib/reporting/__tests__/`
  — 98 tests pass / 0 fail.
- [x] `node --experimental-strip-types --test lib/reporting/__tests__/active-creatives-refresh-runner.test.ts`
  — 12 tests pass (including the new round-trip test).

## Hard constraints honoured

- ✅ `lib/meta/audience-payload.ts` `video_views` branch untouched
  (`contextId` requirement is correct; we're feeding it, not changing it).
- ✅ 5-source split / page-engagement paths / bulk-page builder
  untouched.
- ✅ `CREATIVE_BATCH_SIZE` stays at 25, `AD_INSIGHT_CHUNK_CONCURRENCY`
  stays at 1.
- ✅ Snapshot write contract preserved — refusal on `kind:"skip"|"error"`
  flows through naturally (`audience_video_sources` is only ever
  populated on `kind:"ok"` results).
- ✅ No migration — `audience_video_sources` lives inside the existing
  jsonb `payload`.
- ✅ Service-role reads only, via `userClient → eventIds →
  serviceClient → snapshots` (preview/create routes verify event
  ownership via the user-scoped events query in `runBulkVideoPreview`
  before passing eventIds to `getVideoSourcesFromSnapshot`).
- ✅ Live walk path fully intact as fallback.

## Notes

**Cache hit eliminates BOTH the per-event campaign walk AND the unified
video metadata hydration.** The writer guarantees every persisted
`(video_id, context_page_id)` pair has a resolved Page (we drop pairs
missing either side), so the orphan filter in Phase 3 is a pass-through
for cache hits. A fully-cached batch makes ONE Meta call (the
ad-account `/campaigns` listing for `matchedCampaigns` display) — down
from N campaigns × N events of per-campaign walks plus a video
metadata batch.

**Rate-limit safety improved.** Pre-PR a Meta rate-limit during the
hydration phase aborted the whole batch (all events skipped). With
cache hits, only live-walk events hit the rate-limit fence; cache-hit
events still produce valid audiences. Headline win when one event
trips Meta's per-account budget — the other 59 of WC26 still ship.

**Why date_preset=maximum.** The cache key is
`(event_id, date_preset, custom_since, custom_until)`. The audience
builder wants the widest video set, not a timeframe-filtered slice;
`maximum` is in `DEFAULT_REFRESH_PRESETS` so the cron always populates
it, and it contains every video that's ever spent on the event.

**Follow-ups (not blockers).**

- The pre-existing `lib/audiences/__tests__/batch-fetch-video-metadata.test.ts`
  failure is unrelated to this PR — fails identically on `main` (asserts
  `sources.ts` shape that has drifted since the test was written).
  Track separately if anyone cares.
- We could expose a refresh-now button on the bulk preview UI for events
  showing "cache (stale)" / "live walk" badges. Out of scope for this PR.
