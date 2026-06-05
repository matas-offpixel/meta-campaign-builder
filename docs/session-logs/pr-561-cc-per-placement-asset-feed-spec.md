# Session log — cc/per-placement-asset-feed-spec

## PR

- **Number:** 561
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/561
- **Branch:** `cc/per-placement-asset-feed-spec`

## Summary

Stage B fix for the dual-asset placement bug audited in PR #560. Adds a new
`buildMultiPlacementCreative` sibling to the single-asset builders: when a
creative has BOTH a Feed (4:5/1:1) and a vertical (9:16) asset of the same media
kind, it emits `asset_feed_spec` + `asset_customization_rules` so Feed renders
the 4:5 asset and Stories/Reels render the 9:16 asset. Gated behind
`ENABLE_MULTI_PLACEMENT_ASSETS=1` for safe rollback. Both launch paths inherit
the fix via the shared `buildCreativePayload`.

## Scope / files

- `lib/meta/creative.ts`
  - New `asset_feed_spec` types (`AssetFeedSpec`, `AssetCustomizationRule`, etc.)
    and `asset_feed_spec` field on `MetaCreativePayload`.
  - `detectMultiPlacement` + `buildMultiPlacementCreative` + placement taxonomy
    (`STORIES_REELS_SPEC`; Feed = empty-spec catch-all default).
  - `buildCreativePayload` routes to multi-placement when flag ON and a plan is
    detected; otherwise unchanged legacy path.
  - Sanitizer: removed `asset_feed_spec` from unconditional strip list; now
    preserves user-configured specs (have `asset_customization_rules`) and strips
    Advantage+/Dynamic-Creative auto specs (no rules). New report field
    `assetFeedSpec: "preserved" | "stripped" | "absent"`.
- `components/steps/creatives.tsx` — placement explainer above multi-slot grids
  (slot tiles already showed "4:5 · Feed" / "9:16 · Story / Reel").
- `lib/meta/__tests__/creative-multi-placement.test.ts` — new test suite.
- `CLAUDE.md` — env var `ENABLE_MULTI_PLACEMENT_ASSETS`, architecture note,
  known-limitation note for pre-fix launches.

## Decisions / divergences from the prompt (doc-backed)

1. **`object_story_spec` carries `page_id` ONLY** (no seeded `video_data` /
   `link_data`). Meta's Placement Asset Customization docs show assets live in
   `asset_feed_spec`; the fallback is a catch-all rule, not a seeded story spec.
   Mixing `video_data`/`link_data` with `asset_feed_spec` risks code=100.
2. **Feed/default rule uses an empty `customization_spec` ({})** as the
   documented catch-all (Threads example), guaranteeing full coverage of all
   automatic placements rather than enumerating Feed positions and risking gaps.
3. **`optimization_type: "PLACEMENT"`** set per the canonical examples.
4. **Same-media only.** Mixed image+video per-placement falls through to the
   legacy single-asset path (documented follow-up).
5. **1:1 in "full" mode** is not given its own rule (prompt: never auto-assign
   1:1); 4:5 is the Feed/default and 9:16 is Stories/Reels.

## Validation

- [x] `node --test` for `creative-multi-placement.test.ts` + existing
  `creative-video-thumbnail.test.ts` → 15/15 pass (no regression).
- [x] `npx tsc --noEmit` — no errors in touched files (pre-existing failures in
  unrelated jest-style test files remain).
- [x] `eslint` touched files — 0 errors.
- [ ] Vercel preview green
- [ ] Manual: launch a tiny test campaign with a dual-asset creative + flag ON;
  confirm Ads Manager preview "All placements" splits into Feed (4:5) and
  Stories (9:16).

## Notes

- Feature flag defaults OFF — production must set `ENABLE_MULTI_PLACEMENT_ASSETS=1`.
- Rollback = unset the flag (no redeploy of code needed).
