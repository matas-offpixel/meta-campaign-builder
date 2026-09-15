# The library carry rule was inverted. The operator ticks what to keep.

## PR

- **Number:** 946
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/946
- **Branch:** `cursor/tiktok-import-originals`

## Summary

The #945 carry rule — in the Creative Library ⇔ an original the operator
uploaded — is false on the live Ironworks Smart+ campaign. TikTok writes its
variants into `/file/video/ad/search/` the day after launch, and the nine
inline-uploaded originals in `80% Sold` / `Overlays` are absent. Import no
longer decides. It shows every unique source creative; the operator ticks what
to carry. A name-pattern default suggests which rows look TikTok-generated. A
pattern never removes a row. Nothing is saved until confirm.

## Scope / files

- `lib/tiktok/import/__fixtures__/captured/tiktok-import-capture-1876044101888033.json`
  — verbatim Smart+ raw-route capture (signed library URLs stripped).
- `lib/tiktok/import/capture.ts` — `bundleFromRawCapture`.
- `lib/tiktok/import/picker.ts` — generated-name patterns (capture-true remix
  regex), stem, picker rows, thumbnail hydration via `/file/video/ad/info/`.
- `lib/tiktok/import/map.ts` — unique-by-`video_id` / Spark-by-`tiktok_item_id`,
  stem collapse preferring a library id, Spark before carousel, two-step
  `carry`.
- `lib/tiktok/import/readers.ts` — library rows are metadata; empty library
  does not throw.
- `app/api/tiktok/campaigns/import/route.ts` — no `carry` → picker, no save;
  `carry: []` → no save; keys → draft.
- `components/tiktok/tiktok-import-picker.tsx` — read → tick → save.
- `doc-derived-v1.3.ts` retired as a fixture for every path the captures cover.

## Validation

- [x] `npm test` (5844 pass, 6 skipped)
- [x] `npm run build`
- [ ] Manual capture `tiktok-import-capture-1874142286754113.json` was not in
      the worktree or `~/Downloads` when this branch opened. Those two tests
      skip until the file is dropped into `captured/`.

## Notes

- Remix ids on the wire are `v10033g50000da2tkln…_1200101-N`. The pattern is
  `^v\d{5}g[0-9a-z]+_\d+-\d+$`, not the sketch `g\d+`.
- An inline-upload `video_id` referenced as `VIDEO_REFERENCE` on a new ad is
  unknown until a launch tries it. Stem collapse prefers the library copy.
- `lib/tiktok/write/**`, `evaluate.ts`, `apply.ts`, `gates.ts`,
  `components/plan/**` untouched. No migration.
