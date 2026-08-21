# Session log

## PR

- **Number:** 811
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/811
- **Branch:** `cursor/tiktok-lead-generation-objective`

## Summary

TikTok retired the Conversions objective from Ads Manager. Website registration now runs as an optimization location under Lead generation — the configuration of the live Ironworks campaign. The wizard offered the retired objective and not the working one. This PR adds Lead generation with the website location (`promotion_target_type: EXTERNAL_WEBSITE`), marks Conversions retired without breaking drafts that still use it, and leaves the #808 deny-list scoped to CONVERSIONS.

## Scope / files

- `lib/types/tiktok-draft.ts` — `LEAD_GENERATION` on `TikTokObjective`
- `lib/tiktok-wizard/campaign-setup.ts` — picker, retired label, Lead gen goal
- `lib/tiktok/write/mapping.ts` — `objective_type`, `promotion_target_type`, pixel fields
- `lib/tiktok/write/preflight.ts` — pixel/event required for Lead generation
- `components/tiktok-wizard/steps/campaign-setup.tsx` — retired warning + website location copy
- `components/tiktok-wizard/steps/review-launch.tsx` — labels + location
- Tests: mapping, preflight, deny-list, migrate, launch

## Validation

- [x] `npm run build` (clean; existing Remotion `config` warning only)
- [x] Changed-file lint clean (repo-wide lint still has 27 pre-existing errors)
- [x] `npm test` — 4057 = 4041 passed + 13 failed + 3 skipped

## Notes

SDK `CampaignCreateBody.objective_type` / `AdgroupCreateBody.optimization_goal` are unconstrained `str`. Enum values come from SDK `TargetingSearchBody` / `TargetingInfoBody`: REACH, TRAFFIC, VIDEO_VIEWS, LEAD_GENERATION, ENGAGEMENT, APP_PROMOTION, WEB_CONVERSIONS, PRODUCT_SALES.

Optimization location field is `promotion_target_type` (SDK ToolApi): INSTANT_PAGE | EXTERNAL_WEBSITE. Instant Form not implemented.

Smart+ unified workflow: regular `CampaignCreateBody` has no Smart+ field; Smart+ uses a separate `SmartPlusAdgroupCreateBody`. The launcher block is still correct. No Smart+ change in this PR.
