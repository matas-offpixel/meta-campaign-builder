# Session log: repair-video-thumbnails.mjs found zero broken creatives — discovery pivot (task #128 follow-up)

## PR

- **Number:** 763
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/763
- **Branch:** `cursor/repair-video-thumbnails-meta-pivot`

## Summary

`scripts/repair-video-thumbnails.mjs` (PR #762) found **zero** broken
creatives when run against production data. Root cause: its discovery pass
filtered on `creative.mediaType !== "video" || !creative.metaCreativeId`, but
`metaCreativeId` is **never written back** to `campaign_drafts.draft_json`
after launch — confirmed via SQL: draft `faf11b6f-…` / creative
`6e168e8b-…` (IPC – Motion 1) has no `metaCreativeId` key at all, even though
the ad is live on Meta with a spinner-hash creative. `draft_json` is a
point-in-time autosave snapshot; it was never designed to be re-synced with
what Meta actually created after launch.

**Fix:** pivot discovery from "scan the draft snapshot" to "query Meta
directly for the affected campaigns." `campaign_drafts` is now used ONLY to
discover which `metaCampaignId`(s)/`adAccountId` exist per draft — every
statement about the actual live ad/creative/thumbnail comes straight from the
Graph API.

## Scope / files

- `lib/meta/video-thumbnail-repair-scan.ts` (new) — canonical, unit-tested
  detection pipeline:
  1. `fetchCampaignAds(campaignId, token)` — paginated
     `GET /{campaignId}/ads?fields=id,name,creative{id,object_story_spec}`.
  2. `resolveVideoCreativeInfo(ad, token)` — pulls `video_id`/`image_hash`
     out of the ad's (usually already-expanded) `object_story_spec`; falls
     back to a direct `GET /{creativeId}?fields=object_story_spec` on the
     rare ad where Meta didn't expand the nested field.
  3. `resolveImageHashUrl(adAccountId, hash, token)` —
     `GET /{adAccountId}/adimages?hashes=["<hash>"]` resolves the CDN URL
     Meta is *currently* serving for that `image_hash`.
  4. `scanCampaignForBrokenVideoAds(campaignId, adAccountId, token, opts)`
     wires the above together, dedupes hash resolution across ads that share
     one creative, and flags an ad broken via the existing
     `isMetaPlaceholderThumbnailUrl` (from `video-thumbnail-poll.ts`,
     unchanged). Rate-limit-friendly: sleeps `opts.sleepMs` (default 1000,
     pass `0` in tests) between each ad's creative resolution and each unique
     hash resolution.
  - `extractVideoCreativeInfoFromSpec` / `findBrokenVideoAds` are exposed as
    pure helpers so the detection logic can be tested in isolation from the
    network pipeline.
- `scripts/repair-video-thumbnails.mjs` (discovery pass rewritten, repair
  pass logic preserved):
  - `loadCandidateDrafts()` — unchanged (still the entry point), but its
    output is now used only to extract `metaCampaignId` (primary launch) +
    every `campaignAttachResults[].campaignId` (task #125 multi-campaign
    bulk-attach) + `adAccountId` per draft.
  - `collectCampaignTargets(rows)` (new, replaces the old
    `pickPrimaryVideoAsset`/`VIDEO_PRIORITY` draft-asset logic) — dedupes to
    one scan target per distinct `(adAccountId, campaignId)` pair.
  - `fetchCampaignAds` / `fetchCreativeObjectStorySpecForAd` /
    `resolveImageHashUrl` / `scanCampaignForBrokenVideoAds` (new) — inline
    mirror of the new lib module (same convention as
    `isMetaPlaceholderThumbnailUrl` already being duplicated inline), so the
    plain `.mjs` script still needs no TS loader.
  - `collectBrokenCreatives(campaignTargets)` — now `async`; scans every
    discovered campaign on Meta and dedupes broken ads by Meta creative id.
  - Repair pass (`fetchCurrentPicture` → `uploadImageFromUrl` →
    `fetchCurrentObjectStorySpec` → `patchCreativeImageHash`) is unchanged in
    substance, but now keys off the ad's actual `creativeId`/`videoId` read
    from Meta (not from the draft).
  - `patchDraftAssetThumbnail` → renamed
    `patchDraftAssetThumbnailsByVideoId` and now matches by `asset.videoId`
    (not `asset.id`/`metaCreativeId`, which aren't reliably present) across
    **every** candidate draft loaded for the run, not just the one draft
    that happened to surface the broken ad on Meta — a duplicated/templated
    creative can otherwise silently keep the placeholder in a sibling draft.
  - Priority list (EED Newcastle v2, IPC Newcastle v3, Colyn Wide, Nora En
    Pure, Booka Shade, Mall Grab, Parable) and rate limits are unchanged in
    intent: 1 ad/sec + 1 hash/sec during discovery, 1 creative/sec during
    repair.
- Tests:
  - `lib/meta/__tests__/video-thumbnail-repair-scan.test.ts` (new, 23 cases)
    — pure extraction/filter helpers; each network call
    (`fetchCampaignAds` incl. pagination + error handling,
    `fetchCreativeObjectStorySpec` fallback, `resolveImageHashUrl` incl.
    `act_` prefix handling) mocked via `globalThis.fetch`; end-to-end
    `scanCampaignForBrokenVideoAds` pipeline tests (identifies the broken ad
    from a full mocked `/ads` → `/adimages` round trip, returns empty when
    everything resolves to real content, dedupes hash resolution across ads
    sharing one creative, tolerates one ad's creative-fetch failure without
    aborting the scan).
  - `lib/meta/__tests__/upload-video-thumbnail.test.ts` —
    `isMetaPlaceholderThumbnailUrl` regression tests untouched, still pass.

## Not included (flagged as follow-up)

- **Task #130 (separate PR):** write `metaCreativeId` back to
  `draft_json`'s creatives array in `launch-campaign/route.ts` Phase 4 (the
  ad's returned `creative_id` maps 1:1 to the source creative once launched).
  Would let future repair/diagnostic scripts trust the draft snapshot again
  instead of always round-tripping through Meta — not required for this fix
  since the Meta-direct approach works regardless.

## Validation

- [x] `node --check scripts/repair-video-thumbnails.mjs` — syntax valid.
- [x] `node --conditions react-server --experimental-strip-types --test lib/meta/__tests__/video-thumbnail-repair-scan.test.ts` — 23/23 pass.
- [x] `npx tsc --noEmit` — 370 pre-existing errors, none in files this PR touches.
- [x] `npm test` — 3654 tests, 3638 pass, 13 fail; all 13 are the same
      pre-existing failures as baseline (dashboard/`@/lib` alias resolution,
      asset-queue, creative-buy-tickets-cta) — none touch the files this PR
      modifies.
- [x] `npm run lint` — 272 problems (54 errors / 218 warnings), identical to
      baseline; zero lint issues in any file touched by this PR.
- [x] `npm run build` — succeeds.

## Notes

- Still not run against production data as part of this PR (no Meta/Supabase
  credentials in this environment) — dry-run first, review the discovery
  pass's per-campaign ad counts and the "Found N broken video ad(s)" line,
  then re-run with `--live`.
