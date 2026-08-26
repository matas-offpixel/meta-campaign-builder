# Session log

## PR

- **Number:** 849
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/849
- **Branch:** `cursor/plan-d4` (stacked on `cursor/plan-d3`)

## Summary

Plan UI: `/plans` list + `/plan/[id]` (including `/plan/new`) workspace. Shared inputs once, three adapter previews with plan-level preflight, one **Launch all (paused)** button disabled with the named gate reason when `ENABLE_PLAN_FANOUT` is not `"1"`. Ads Manager links reuse existing Meta / TikTok / Google URL formulas. Honest empty states when migration 157 is unapplied, when there are no events, and when a plan id is missing.

## Scope / files

- `app/(dashboard)/plans/page.tsx`
- `app/(dashboard)/plan/[id]/page.tsx`
- `components/plan/plan-workspace.tsx`
- `app/api/plan/preflight/route.ts`
- `lib/plan/ads-manager-links.ts`, `empty-plan.ts`, `load.ts`
- `components/dashboard/dashboard-nav.tsx` (Plans item)
- `lib/plan/__tests__/plan-ui.test.ts`

## Validation

- [x] `npm test` — 4451 pass, 0 fail, 3 skipped
- [x] eslint clean on touched files
- [x] `npm run build` — includes `/plans`, `/plan/[id]`, `/api/plan/preflight`

## Notes

- Inventory: `campaign_plans` is not in generated types and is unapplied. List degrades to the 157 empty state. Google Ads Manager link needs `clients.google_ads_customer_id` + a platform campaign resource name. TikTok Ads Manager has no campaign-selection param (reuse `buildTikTokAdsManagerUrl`); advertiser id is used only when the user has exactly one `tiktok_accounts.tiktok_advertiser_id`.
- Fan-out still does not persist launch child rows (D.3 is in-memory). Load path reads the 157 child tables when they exist.
- Falsification: parent `8899dad` has no `lib/plan/ads-manager-links.ts` / plan pages.
