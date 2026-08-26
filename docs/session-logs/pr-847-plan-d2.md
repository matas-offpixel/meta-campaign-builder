# Session log

## PR

- **Number:** 847
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/847
- **Branch:** `cursor/plan-d2` (stacked on `cursor/plan-d1`)

## Summary

Plan → existing draft adapters for Meta, TikTok, and Google, plus plan-level preflight that reuses each platform's validator so the operator sees every blocker in one list. No launch code.

## Scope / files

- `lib/plan/adapters/{meta,tiktok,google}.ts`
- `lib/plan/preflight.ts`
- `lib/plan/__tests__/adapters.test.ts`

## Inventory

- Meta draft factory: `createDefaultDraft` / `createDefaultCreative`. Destination is `AdCreativeDraft.destinationUrl`. No extracted `collectMetaLaunchPreflight` — reused `validateCampaignPayload` + `validateCreativePayload`.
- TikTok: `createDefaultTikTokDraft` + `collectTikTokLaunchPreflight` (includes GBP ad-group floor). `CONVERSIONS` is retired; purchase/registration map to `LEAD_GENERATION`.
- Google live shape is `GoogleSearchPlanTree` (`google_search_plans` 096), validated by `validateGoogleSearchPlan`. Adapter does **not** invent keywords.

## Validation

- [x] `npm test` — 4440 pass, 0 fail, 3 skipped
- [x] eslint on new files — clean
- [x] `npm run build` — compiled successfully

## Notes

- Falsification: `git show cursor/plan-d1:lib/plan/adapters/meta.ts` exits 128.
- Tests assert invariants (event/URL/split threading; preflight message-set equality with the platform validators), not literal issue lists.
