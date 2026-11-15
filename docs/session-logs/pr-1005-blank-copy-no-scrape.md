# Blank headline and description launch blank

## PR

- **Number:** 1005
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1005
- **Branch:** `cursor/blank-copy-no-scrape`

## Summary

When the launcher's headline or description is empty, the payload now sends a single space. Meta stores `""` as absent and scrapes the destination page's `og:title` and `og:description` into those slots — that was the "DHB Tickets Dubai 2026 – Party" headline and the rogue link description. A space is the only value proven to suppress both scrapes (probe campaign `120250184738460453`, ads zz-1..zz-7, 2026-09-30). Operator-typed text is unchanged. A space read back from Meta becomes an empty field in the importer, the preview, and a loaded draft.

## Scope / files

- `lib/meta/creative.ts` — `blankAsNoScrape`, applied on `link_data`, `video_data.title`, and both `asset_feed_spec` builders. `video_data` still has no description. Existing-post boosts are untouched.
- `lib/reporting/creative-preview-extract.ts` and `lib/reporting/active-creatives-fetch.ts` — a space is absent, and it does not fall through to the creative's internal name.
- `lib/meta/import/creative-copy.ts` already trimmed; the DHB fixture test now asserts a space title lands empty while real copy is unchanged.
- `lib/autosave.ts` — loading a draft collapses a whitespace-only headline or description to `""`.
- `components/steps/review-launch.tsx` — the creative line notes `headline: none · description: none` when a field was blank.
- `creative_scores` stores tag definitions, not ad copy, so there was no extractor there to change.

## Validation

- [x] `npm test` — 6,522 tests, 6,519 pass, 0 fail, 3 skipped
- [x] `npm run build` — green
- [ ] check-run conclusions recorded in the thread after the PR opens

## Notes

No migration. `destination_type` (#1003/#1004), the launch route's write set, and TikTok / optimisation / Google paths were not changed. Creatives that already have copy send the same title and description strings as before.
