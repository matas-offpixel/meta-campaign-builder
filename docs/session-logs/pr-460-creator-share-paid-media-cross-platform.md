# Session log — fix(share): aggregate Paid media Spent across Meta + TikTok + Google Ads

## PR

- **Number:** 460
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/460
- **Branch:** `creator/share-paid-media-cross-platform`

## Summary

Fixes a quiet, persistent reporting bug on every brand_campaign share report with multi-platform spend. The Performance Summary card's "Paid media Spent" figure (and derived % used and cost-per-ticket) counted only Meta spend because `sumLifetimeMetaSpend` hard-coded `tiktok_spend: null` and omitted `google_ads_spend` entirely when calling the cross-platform `paidSpendOf` helper. The fix extracts a correctly-named `sumLifetimePaidMediaSpend` to `lib/dashboard/` that passes real TikTok and Google Ads values, and updates the single call site in the share report. Confirmed live on BB26-KAYODE: headline will change from "£177 Spent (37%)" to "£477 Spent (99%)".

## Scope / files

- `lib/dashboard/sum-lifetime-paid-media-spend.ts` — new exported helper (extracted from component for testability)
- `lib/dashboard/__tests__/sum-lifetime-paid-media-spend.test.ts` — 6 tests including the exact BB26-KAYODE regression scenario
- `components/share/venue-full-report.tsx` — removed buggy `sumLifetimeMetaSpend`, added import, updated call site at `computeVenuePerformance`

## Validation

- [x] `npx tsc --noEmit` — no errors in touched files (pre-existing audience test errors unrelated)
- [x] `npx eslint components/share/ lib/dashboard/` — clean
- [x] `node --experimental-strip-types --test 'lib/dashboard/__tests__/sum-lifetime-paid-media-spend.test.ts'` — 6/6 pass
- [x] `npm run build` — clean

## Notes

- `paidSpendOf` and `metaPaidSpendOf` in `lib/dashboard/paid-spend.ts` are correct and untouched — the bug was solely the caller.
- The Meta-tab `MetaReportBlock` deliberately remains Meta-only; this fix is scoped to the cross-platform Performance Summary card only.
- After merge: worth re-checking 4theFans dashboard Performance Summary headlines too — they use a separate aggregation path but the same underlying `paidSpendOf` helper, so they should already be correct.
