## PR

- **Number:** 218
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/218
- **Branch:** `creator/google-ads-rollup-sync-fix`

## Summary

Daily Google Ads rollups were scaffolded but the cron runner skipped BB26-KAYODE because it has Google Ads connected but no ticketing link and no `general_sale_at`. This change keeps the existing ticketing/date cron eligibility intact and adds Google Ads-connected events, zero-pads Google Ads rows across the sync window, and adds a session-bound one-shot Google Ads backfill route for a single event.

## Scope / files

- `app/api/cron/rollup-sync-events/route.ts` includes events with `events.google_ads_account_id IS NOT NULL`.
- `lib/dashboard/google-ads-rollup-leg.ts` zero-pads connected events so no-data days write explicit zeros.
- `lib/google-ads/rollup-insights.ts` uses `segments.date` daily GAQL and derives video views from the 25% quartile rate when present.
- `app/api/admin/google-ads-backfill/route.ts` runs the Google Ads leg for one owner-authorized event.
- Focused tests cover Google Ads leg skip/zero-padding and daily GAQL/video-view mapping.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint lib/db/ lib/google-ads/ lib/dashboard/ app/api/cron/ app/api/admin/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts' 'lib/db/__tests__/*.test.ts'`
- [x] `node --experimental-strip-types --test 'lib/dashboard/__tests__/rollup-sync-runner.test.ts' 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes

- BB26-KAYODE currently has `google_ads_account_id`, no ticketing links, `general_sale_at = null`, and NULL `google_ads_*` rollup columns for 23-30 Apr.
- A direct local backfill attempt reached the Google Ads leg but could not decrypt credentials because this local env lacks `GOOGLE_ADS_TOKEN_KEY`; the production route should be called after deploy where the key is present.
- Leeds FA Cup was checked as a no-Google-Ads event; its Google Ads columns remain NULL and existing Meta/TikTok rows are untouched.
- The requested broad ESLint command passes with warnings only in unrelated pre-existing files: `lib/db/additional-spend.ts` and `lib/db/templates.ts`.
