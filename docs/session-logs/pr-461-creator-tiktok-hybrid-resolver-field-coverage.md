# Session log — feat(share): surface reach + 2s/6s/avg-play-time on hybrid TikTok block

## PR

- **Number:** 461
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/461
- **Branch:** `creator/tiktok-hybrid-resolver-field-coverage`

## Summary

Fixes six em-dash fields on the hybrid TikTok block of share reports (confirmed live on BB26-KAYODE). The root cause was two-part: `aggregateTikTokRollups` only summed 4 of the 10 TikTok rollup columns (spend, impressions, clicks, video_views_100p), and `resolveTikTokHybridReport` hard-coded null for reach, frequency, cost_per_1000_reached, video_views_2s, video_views_6s, and avg_play_time_per_user. The aggregator is extracted to `lib/share/tiktok-aggregator.ts` with the full field set, and the resolver is wired to derive the six previously-null fields from the new totals. BB26-KAYODE fixture test is the regression anchor.

## Scope / files

- `lib/share/tiktok-aggregator.ts` — extracted + extended aggregator (reach, vv2s, vv6s, postEngagement, results, avgPlayTimeMsTotal/Rows)
- `lib/share/__tests__/tiktok-aggregator.test.ts` — 6 tests including BB26-KAYODE regression, null-reach guard, all-zero || null, avg_play_time denominator, window exclusion, empty array
- `app/share/report/[token]/page.tsx` — import new aggregator, remove inline old function, wire reach/frequency/cpr1k/vv2s/vv6s/avg_play_time into campaign object

## Validation

- [x] `npx tsc --noEmit` — no errors in touched files
- [x] `npx eslint app/share/report/ lib/share/tiktok-aggregator.ts` — clean
- [x] `node --experimental-strip-types --test 'lib/share/__tests__/tiktok-aggregator.test.ts'` — 6/6 pass
- [x] `npm run build` — clean

## Notes

- Reach is sum-of-daily-reach (over-counts multi-day users) — same convention as the Meta block. A deduplication step is a larger architectural change deferred.
- `avg_play_time_per_user` averages by rows-with-data (not impressions-weighted). Matches Meta block day-averaging convention; documented in JSDoc.
- Manual XLSX import path (`resolveTikTokReportBlock` lines 1412-1421) is untouched — manual imports remain authoritative.
- Geo / demographics / interests / ads remain snapshot-sourced; this fix is campaign-totals only.
- After merge: BB26-KAYODE TikTok block shows Reach 551,804 · Frequency ~1.00 · Cost/1000 reached £0.29 · vv2s 467,730 · vv6s 301,644 · Avg play time ~9ms. Em-dashes only remain on fields not yet in the rollup (interactive addon etc.).
