# Isolate a bad thumbnail id; badge unjoined rows

## PR

- **Number:** 950
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/950
- **Branch:** `cursor/tiktok-picker-thumbnails`

## Summary

#949 retried a failed `/file/video/ad/info/` chunk once, then marked every
id `thumbnailError`. One permanently-bad `video_id` in a 60-id chunk
lost the other 59, and the mixed-chunk test was rewritten to pin that.
A failed chunk now splits in half and recurses to a floor of 1, so a
good id in a mixed chunk keeps its thumbnail. Unjoined rows carry
`origin` onto the picker row and render *"TikTok couldn't confirm you
selected this"* next to the row name, inside the label. The assertion
is on the formatter over `picker.rows`, not the DOM. `"tiktok_added"`
is gone from the union — there is no documented split that would assign
it.

## Scope / files

- `lib/tiktok/import/picker.ts` — binary-split thumbnail load; drop
  same-chunk retry; keep `!row.disabled` so a blocked row's ad_id is
  never posted as a `video_id`; `origin` on the row; origin badge
  formatter.
- `lib/tiktok/import/map.ts` — copy `origin` onto unique picker rows
  (`unjoined` if any source in the stem group is unmatched).
- `components/tiktok/tiktok-import-picker.tsx` — unjoined badge; join
  and unjoined header formatters called once each.
- `lib/tiktok/import/types.ts` — one line: manual carousels are
  reported under a different reason until `/ad/get/` is captured.
- Tests: mixed chunk restores the good thumbnail; 4-id / 1-bad
  recovers 3 and stays inside `2·⌈log₂ n⌉+1`; all-bad marks all;
  1-of-45 fixture is 44 badged / 1 not, all ticked; grep that
  `tiktok_added` is gone from `lib/tiktok/import`.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 5906 pass, 0 fail, 4 skipped

## Notes

- `!row.disabled` on thumbnail hydration is kept. A blocked row's `key`
  is an ad_id; posting it as a `video_id` cannot resolve, and
  "thumbnail unavailable" would lie about a carousel or image ad.
- Eight paths. No POST. `lib/tiktok/write/**`, `evaluate.ts`,
  `apply.ts`, `gates.ts`, `components/plan/**` untouched. No migration.
  Both captured JSON fixtures stay byte-identical.
