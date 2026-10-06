# Session log — interest-cluster performance report (registration phase)

## PR

- **Number:** 1025
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1025
- **Branch:** `cursor/interest-performance-report`

## Summary

Read-only analysis that ranks every interest cluster (the sorted set of Meta interest ids on an ad set) by registration-phase cost per registration, across all 14 ad accounts the app touches. Its top 8 non-thin clusters seed the saved-clusters feature (Part 2). The run made no writes to Meta, prod, or Cirqlin.

## Scope / files

- `lib/analysis/interest-performance.ts`: pure functions for the registration-phase test, cluster key, one action type per account, cluster and interest stats, the first-party UTM join, ranking, "what to test next", the Markdown renderer (built from the JSON only), and the seed builder.
- `lib/analysis/__tests__/interest-performance.test.ts`.
- `scripts/interest-performance.mts`: Graph pull through `lib/meta/client.ts` (`graphGetWithToken`, pacing on BUC and app usage), cached per ad set under `scripts/out/interest-insights/` (gitignored, custom audience lists replaced by counts). Also reads `launched_ad_sets`, `clients`, `events`, and `event_signups` (`event_id` and `utm` only), and the Cirqlin CSV. Takes `--since` and `--refresh`.
- `docs/analysis/interest-performance-2026-10-06.{md,json}`, `docs/analysis/interest-templates-seed.json`, `docs/analysis/cirqlin-signup-utms-2026-10-06.csv`.
- Cirqlin: `scripts/export-signup-utms.mts` on branch `cursor/export-signup-utms` (commit 773d08b). This is the only change in that repo. Counts only, `spam_verdict = 'ok'`.

## Validation

- [x] New unit tests (6 pass)
- [x] `npm test`
- [x] `npm run build`
- [x] Script re-run from cache gives the same totals

## Notes

- The token read all 14 accounts, including the three under BM 1927009767586803. None were refused.
- `complete_registration` and `offsite_conversion.fb_pixel_complete_registration` are identical on every account, so they are the same pixel events under two names. The action type is chosen per account by largest total. Junction 2 chose `complete_registration`; its 49 ad sets that report `lead` only count as 0 here.
- First-party credit per ad set is applied only when first-party ÷ pixel for the campaign is between 0.67 and 1.5. FOLAMOUR and FOLMAOUR were 0.55 and 57.6: static utm_campaign text was copied from the duplicated campaign, so utm_content names the wrong ad sets.
- Most first-party matches go through the campaign name. Part 3 (`url_tags` with `{{campaign.name}}` / `{{adset.name}}`) makes this measurable per ad set for future launches.
