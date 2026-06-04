# Session log — parallel upload stale-closure fix

## PR

- **Number:** 537
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/537
- **Branch:** `cc/parallel-upload-stale-closure-fix`

## Summary

Fixed a stale-closure bug where two parallel asset uploads within the same `AssetVariationCard`
(dual 4:5 + 9:16 mode) would each build their completion patch from a render-time snapshot of the
variation's assets array (`slots`). Whichever upload completed second would rewrite the whole
array from that stale snapshot, rolling back the first slot's "uploaded" status. The server
returned 201 for both requests; only the UI state was broken.

Root cause: `updateAsset` read from the closure-captured `slots` variable instead of reading
current state at write time. The same class of bug existed in `updateAd` (closure-captured
`creatives`).

Fix: introduce a functional-updater form for `AssetVariationCard.onUpdate`. The `updateAsset`
function now calls `onUpdate((prev) => ({ assets: prev.assets.map(...) }))`, letting
`updateAssetVariation` apply the function against the **current** variation read from
`creativesRef.current`. This breaks the stale closure at every level of the call chain.

## Scope / files

- `lib/creatives/asset-variation-updater.ts` *(new)* — pure reducer `applyVariationUpdate` +
  exported `AssetVariationUpdater` type
- `lib/creatives/__tests__/asset-variation-updater.test.ts` *(new)* — 6 tests incl. regression
  for "parallel uploads both land" and "stale-patch form would clobber"
- `components/steps/creatives.tsx`
  - Import `applyVariationUpdate` and `AssetVariationUpdater`
  - `updateAd`: use `creativesRef.current` instead of stale `creatives` closure; remove
    `creatives` from `useCallback` deps
  - `updateAssetVariation`: accept `AssetVariationUpdater`; call `applyVariationUpdate`
    with `creativesRef.current`; wrap in `useCallback([onChange])`
  - `AssetVariationCard.onUpdate` prop: `(updater: AssetVariationUpdater) => void`
  - `updateAsset` inside `AssetVariationCard`: use `(prev) => ...` functional form

## Validation

- [x] `npx tsc --noEmit` — no new errors
- [x] `node --experimental-strip-types --test 'lib/creatives/__tests__/asset-variation-updater.test.ts'` — 6/6 pass
- [ ] Manual: dual-video upload at `/campaign/[draft-id]` → Creatives → Dual (4:5 + 9:16) →
  upload two files from same variation — both slots should show "uploaded"

## Notes

- The call site at line 858 (`onUpdate={(patch) => updateAssetVariation(..., patch)}`) required
  no change — TypeScript accepts the union type transparently and the plain-patch form still works
  for non-upload callers like `onUpdate({ name: e.target.value })`.
- `handleBulkVariationFiles` already used `creativesRef.current` for its async callbacks
  (one variation per file, sequential uploads) — that path was correct before this fix.
