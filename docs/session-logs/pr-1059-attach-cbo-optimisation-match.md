# Session log

## PR

- **Number:** 1059
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1059
- **Branch:** `cursor/attach-cbo-optimisation-match`

## Summary

A lowest-cost campaign budget requires every ad set to optimise for the same thing. Attaching a copied Purchase draft to `[IRWOHD] Traffic` sent `OFFSITE_CONVERSIONS` / `PURCHASE` because the snapshot's raw objective still matched, so the drift check kept the draft. The new ad set now takes the live ad sets' majority optimisation. A cost-cap campaign still keeps the draft's goal. When the majority cannot be resolved, the launch stops before any audience, creative, or ad set is created.

## Scope / files

- `lib/meta/attach-optimisation.ts` — majority vote, warning, refusal
- `app/api/meta/launch-campaign/route.ts` — live read, including an empty campaign list that still has the singular campaign
- `lib/meta/client.ts`, `app/api/meta/campaigns/route.ts` — `bid_strategy` and budgets on the campaign read
- `components/steps/campaign-setup.tsx`, `components/steps/review-launch.tsx` — "This campaign optimises for Landing page views; new ad sets will too."

## Validation

- [x] `npx tsc --noEmit` — no errors in touched files (full tree still exits 2 on pre-existing errors)
- [x] `npm run build`
- [x] `npm test` — 7318 pass, 0 fail, 4 skipped, plus 8 vitest
- [x] ESLint on touched files — no new warnings (pre-existing unused imports on the launch route and Review remain)

## Notes

Read-only check of draft `fa62fcd4` against campaign `52531006358507`: lowest cost, daily campaign budget, four ad sets on `LANDING_PAGE_VIEWS`. `buildAdSetPayload` would send `optimization_goal: LANDING_PAGE_VIEWS`, `destination_type: WEBSITE`, and no `promoted_object`. No launch.
