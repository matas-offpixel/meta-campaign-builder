# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creator/variations-rotate-via-asset-feed-spec`

## Summary

Fixes silent variation loss: `buildCreativePayload` (`lib/meta/creative.ts`) only
ever read `assetVariations[0]`, so operators uploading N variations expecting
Meta to rotate them (asset_feed_spec / Dynamic Creative) had variations 2..N
silently discarded at payload build time. Prod evidence: J2 Melodic launch
2026-07-02, 2 creatives × 4 variations = 8 intended, only 2 reached Meta.

This PR ships the scoped fix: **Single mode (9:16 only) + N variations** now
builds an `asset_feed_spec` with all N assets and no `asset_customization_rules`,
so Meta rotates across all placements and optimizes toward the best performer.
Dual/Full mode + N variations remains out of scope (explicit decision, logged
clearly, falls back to variation[0] via the existing multi-placement path —
follow-up: `cc/creator/variations-rotate-dual-mode` or a Cursor equivalent).

Originally specified for a `cc/...` (Claude Code) branch; per this repo's
tool-ownership convention (`CLAUDE.md`) the work was redone on a fresh
`cursor/...` branch and implemented by Cursor end-to-end instead.

## Scope / files

- `lib/meta/creative.ts` — new `detectVariationRotation` + `buildVariationRotationCreative`;
  wired into `buildCreativePayload` before the existing multi-placement check;
  `sanitizeCreativeForStrictMode` asset_feed_spec discrimination extended to
  preserve rotation specs (no rules, 2+ assets) instead of stripping them as
  Advantage+ auto specs; `AssetFeedImage.adlabels` / `AssetFeedVideo.adlabels`
  loosened to optional (rotation entries carry no adlabels — there are no
  customization rules to reference them).
- `components/steps/creatives.tsx` — new non-blocking warning banner for
  `cta === "book_now" && assetMode === "single" && variations.length >= 2`,
  sibling to the existing Dual-mode BOOK_NOW banner.
- `lib/meta/__tests__/creative-variation-rotation.test.ts` — new test file
  (13 cases): Single+N image/video rotation payload shape, BOOK_NOW+N
  fallback (image + video), 1-variation regression, Dual-mode+N fallback
  regression (incl. BOOK_NOW+Dual+1), mixed-media guard, flag-off regression,
  sanitizer preserve/strip discrimination.
- `lib/meta/__tests__/creative-multi-placement.test.ts` — updated 3 assertions
  to null-safe `v.adlabels ?? []` after the type change above (no behavioural
  change, existing assertions unchanged).

## Grep proof — every existing `assetVariations[0]`/`assetVariations?.[0]` read site preserved

All single-asset pickers still read `variations[0]` only, by design (that's
correct fallback/legacy behaviour, not a bug — the bug was the *absence* of a
rotation path, not these pickers):

- `pickPrimaryImageHash` (creative.ts:274) — unchanged
- `pickPrimaryVideoAsset` (creative.ts:300) — unchanged
- `pickPrimaryAssetUrl` (creative.ts:313) — unchanged
- `detectMultiPlacement` (creative.ts:~530, was 494) — unchanged, still
  variation[0]-only by design (dual/full mode is out of scope for rotation)
- `buildCreativePayload` hasVideoId/hasImageHash scan (creative.ts, was 802/805) —
  unchanged, scans **all** variations only to pick the video-vs-image branch,
  never to select which assets to send
- `buildCreativePayload` fallthrough diagnostic (creative.ts, was 860) — unchanged
- `validateCreativePayload` (creative.ts, was 943) — unchanged, checks "any
  asset uploaded", not variation-specific

New reads: `detectVariationRotation` iterates **all** `assetVariations` (not
just `[0]`) — this is the fix.

## Test plan

1. Single mode, 4 image variations → `asset_feed_spec.images` = 4 hashes, no
   `asset_customization_rules`. ✅ covered
2. Single mode, 3 video variations → `asset_feed_spec.videos` = 3 videoIds. ✅ covered
3. Single mode, 4 variations + BOOK_NOW → `link_data` with variation[0] hash,
   no `asset_feed_spec`; UI banner condition added (manual Preview check needed
   post-deploy — see below). ✅ payload covered; ⬜ UI screenshot pending Preview
4. Single mode, 1 variation → payload identical to today. ✅ covered
5. Dual mode + 1 variation (regression) → existing multi-placement unchanged. ✅ covered (existing suite, still passing)
6. BOOK_NOW + Dual mode + 1 variation (regression) → existing fallback unchanged. ✅ covered (existing suite, still passing)
7. `npm run build` / `npm run lint` — clean. ✅
8. `npx tsc --noEmit` — no new errors introduced (pre-existing repo-wide error
   count unaffected by this change; verified via before/after diff). ✅
9. `node --test lib/meta/__tests__/creative-variation-rotation.test.ts
   lib/meta/__tests__/creative-multi-placement.test.ts` — 29/29 passing. ✅

Post-merge live test on Vercel prod (not done in this session — requires a
real launch): re-launch J2 Melodic UTB0043-New Retarget Purchase with 4
variations per creative; verify Meta receives `asset_feed_spec` with 8
image_hashes total and payload logs show `VARIATION-ROTATION path (4
variations, image)`.

## Validation

- [x] `npx tsc --noEmit` (no new errors vs. baseline)
- [x] `npm run build`
- [x] `npm run lint` (no new warnings/errors vs. baseline)
- [x] `node --test` on touched test files (29/29 passing)

## Notes

- Dual/Full mode + N variations is explicitly out of scope; falls back to
  variation[0] via the existing multi-placement path with a clear
  `console.error` log per creative.
- Multi-variation captions/headlines/descriptions/destination URLs remain
  variation[0]'s values (Meta supports arrays for these in `asset_feed_spec`
  but that's out of scope here).
- The `sanitizeCreativeForStrictMode` discrimination change (preserve
  no-rules asset_feed_spec when it has 2+ images/videos) is required for this
  feature to survive Creative Integrity Mode, which defaults ON. Without it,
  every rotation payload would have been silently stripped back down to a
  single asset before reaching Meta.
