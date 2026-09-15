# A partial join is silent, an empty list counts as success

## PR

- **Number:** 949
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/949
- **Branch:** `cursor/tiktok-import-partial-join`

## Summary

#946's picker is right on both captures. Verification still found a
wrong reading that produces a plausible surface with no warning: one
`creative_list` join of 45 labelled the other 44 `tiktok_added` and
suppressed the header; an empty Smart+ `creative_list` / `{ list: [] }`
was a successful read; two manual-test assertions could not fail.

`unjoined` is now the count of `/ad/get/` rows that matched no
`creative_list` row, always. The picker reports `chosenJoined` /
`chosenTotal` and the header says both numbers when they disagree. No
threshold for `tiktok_added`. Empty Smart+ ads / empty `creative_list`
throw with the campaign id and the row count. `/ad/get/` no longer
reads `ad_format` or `music_id` — unsupported-format detection is
Smart+-only until that endpoint's accepted list is captured. The
manual capture pins v7 as `VIDEO_REFERENCE` and the eight Spark item
ids. Spark copies are counted. Row `kind` replaces `key.startsWith("v")`.
A failed thumbnail chunk is retried once, then the whole chunk is
marked. Accepted keys no longer print under Rejected keys.

## Scope / files

- `lib/tiktok/import/map.ts` — always-count `unjoined`; `chosenJoined` /
  `chosenTotal`; throw on 0 chosen creatives; stop reading `ad_format` /
  `music_id` on `/ad/get/`; Spark `copies`; row `kind`.
- `lib/tiktok/import/picker.ts` — join line; `kind` on rows; chunk-once
  thumbnail retry.
- `lib/tiktok/import/readers.ts` — empty `/smart_plus/ad/get/` list throws.
- `lib/tiktok/import/types.ts` — unsupported-format is Smart+-only.
- `app/api/tiktok/campaigns/import/route.ts` — second nosave no longer
  feeds accepted keys to `formatRejectedCarryKeys`.
- `components/tiktok/tiktok-import-picker.tsx` — join line in the header.
- Tests: doc-derived 1-of-45, empty list, shared Spark copies; manual
  capture pins v7 / eight item ids / one-in-library / all ticked /
  `unjoined` 0. Both captured JSON fixtures stay byte-identical.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 5903 pass, 0 fail, 4 skipped

## Notes

- Option A for `ad_format`: do not add it to `AD_GET_FIELDS` on a guess.
  Capture `/ad/get/`'s accepted list the same way as
  `adgroup-get-accepted-fields-2026-09-15.ts` before requesting it.
- `lib/tiktok/write/**`, `evaluate.ts`, `apply.ts`, `gates.ts`,
  `components/plan/**` untouched. No migration. Eight paths. No POST.
- Path-literal grep matches `"/…/"` only; a template literal escapes
  both guards.
