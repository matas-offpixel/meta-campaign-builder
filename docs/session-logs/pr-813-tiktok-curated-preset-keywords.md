# Session log

## PR

- **Number:** 813
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/813
- **Branch:** `cursor/tiktok-curated-preset-keywords`

## Summary

Presets were firing single-word seeds at TikTok `FUZZ_MATCH`, a literal substring matcher, so "techno" pulled technology and the Electronic music preset reported 164 junk matches. Each preset now carries curated keyword terms verified against the live Ironworks catalog and applies them by exact match. Unresolved terms are named. Ad-hoc seed search keeps free lookup and adds a word-boundary filter with an unfiltered toggle.

## Scope / files

- `lib/tiktok-wizard/genre-presets.ts` — curated terms, exact resolver, word-boundary helper, limitation note
- `lib/tiktok-wizard/apply-preset.ts` — resolution copy is now "N keyword terms" plus named unresolved terms
- `components/tiktok-wizard/steps/audiences.tsx` — exact apply, word-boundary filter + toggle
- `lib/tiktok-wizard/__tests__/genre-presets.test.ts` / `apply-preset.test.ts`

## Validation

- [x] `npm run build`
- [x] `npx eslint` on changed files
- [x] `npm test` — 4082 = 4066 passed + 13 failed + 3 skipped (pre-existing 13; +8 vs #805's 4074)

## Notes

- Hashtag recommend still unused. Taxonomy path matcher from #798 unchanged.
- Word-boundary keeps "beach house" and "resident evil"; preset exact-match is what makes those structurally impossible on apply.
