# Session log

## PR

- **Number:** 1050
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1050
- **Branch:** `cursor/meta-variations-separate-ads`

## Summary

A creative with N variations now launches as N normal ads, one per variation, in every Meta flow. Dynamic-creative rotation is an opt-in on the creative (`rotateVariations`, default false via `migrateDraft`). With the toggle on, #1049 still applies: the creative needs its own dynamic ad set and is blocked in attach. With it off, those attach blocks do not fire. Launch preflight counts the extra ads against Meta's 50-ads-per-ad-set limit. The existing-post map reads ad set id → creative ids.

## Scope / files

- `lib/meta/variation-ads.ts` — expand, names (` — V1`), ad-limit message, existing-post map
- `lib/meta/creative.ts` — rotation only when `rotateVariations` is true
- `lib/types.ts`, `lib/autosave.ts`, `lib/campaign-defaults.ts` — field, default false
- `app/api/meta/launch-campaign/route.ts`, `bulk-attach-ads/route.ts`, `create-creatives-and-ads/route.ts`
- `components/steps/creatives.tsx` — toggle
- `components/steps/assign-creatives.tsx` and both bulk-attach pages — expanded ad counts
- No change to BOOK_TRAVEL or multi-placement payload shapes

## Validation

- [x] `npx tsc --noEmit` — 346 errors, none in touched files (baseline)
- [x] `npm run build`
- [x] `npm test` — node 7276 tests, 7272 pass, 0 fail, 4 skipped; vitest 8/8

## Notes

The creatives-step toggle was rendered with `renderToStaticMarkup` (shown for single mode + 2 variations; hidden for one variation, dual mode, and existing posts). The wizard was not clicked in a browser. The client bundle still cannot see `ENABLE_MULTI_PLACEMENT_ASSETS`; the launch route is the enforcement. A variation that has Feed and 9:16 uses the existing multi-placement path after it is sliced into its own ad.
