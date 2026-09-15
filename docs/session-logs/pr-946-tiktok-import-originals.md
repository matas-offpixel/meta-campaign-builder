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

Round 2: unjoined rows are counted on the picker again; a failed
`/file/video/ad/info/` id is per-row (`thumbnailError`) and does not fail
the read; thumbnail ids are batched at 60 (same as `fetchVideoInfo` in
`lib/tiktok/share-render.ts`); the allowlist is enforced by a recording
`readTikTokLiveCampaign` + `hydratePickerThumbnails` run; confirm with only
disabled/unknown keys returns `saved: false` and names them.

## Scope / files

- `lib/tiktok/import/__fixtures__/captured/tiktok-import-capture-1876044101888033.json`
  — verbatim Smart+ raw-route capture. `_note` records that
  `preview_url`, `video_cover_url`, `signature`,
  `preview_url_expire_time` were stripped. Library thumbnails are never
  exercised by the capture because `video_cover_url` was stripped.
- `lib/tiktok/import/picker.ts` — unjoined line, `thumbnailError`, chunk 60,
  eighth path literal `/file/video/ad/info/`.
- `lib/tiktok/import/map.ts` — `unjoined` on the picker; `classifyTikTokImportCarry`.
- `app/api/tiktok/campaigns/import/route.ts` — rejected keys named on nosave.
- `components/tiktok/tiktok-import-picker.tsx` — unjoined header, thumbnail
  unavailable, confirm disabled at zero ticked.
- `doc-derived-v1.3.ts` — header lists the tests that still use it; library
  comment is not a carry rule; `Music_Refresh` name matches the pattern.

## Validation

- [x] Import unit tests except the two that load
      `tiktok-import-capture-1874142286754113.json`
- [ ] Manual capture still not in `~/Downloads` or the worktree. Those two
      tests fail (ENOENT), they do not skip.
- [ ] Full `npm test` / `npm run build` / check-runs once the file is dropped
      with a `_note` matching the Smart+ fixture.

## Notes

- Remix ids on the wire are `v10033g50000da2tkln…_1200101-N`. The pattern is
  `^v\d{5}g[0-9a-z]+_\d+-\d+$`, not the sketch `g\d+`.
- An inline-upload `video_id` referenced as `VIDEO_REFERENCE` on a new ad is
  unknown until a launch tries it. Stem collapse prefers the library copy.
- `lib/tiktok/write/**`, `evaluate.ts`, `apply.ts`, `gates.ts`,
  `components/plan/**` untouched. No migration.
