# Session log — bulk-attach ad set picker

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/bulk-attach-ad-set-picker`
- **Base:** `cc/bulk-attach-new-creatives` (PR #544)

## Summary

Adds a per-ad-set selection step (Step 1) to the bulk-attach flow introduced in PR #544. Previously every ad in a selected campaign received the new creatives. Now the user can see all ad sets per campaign, deselect any they don't want, and the route receives an explicit `campaignAdSets` map rather than fetching ad sets itself at launch time.

## Scope / files

### New
- `app/api/meta/bulk-attach-ads/list-adsets/route.ts` — `GET /api/meta/bulk-attach-ads/list-adsets?adAccountId=X&campaignIds=A,B,C`; serial fetch with 1s sleep, rate-limit classifier, `maxDuration = 60`, partial-failure with `partial: true` + `failedCampaignIds`
- `components/bulk-attach/ad-set-picker.tsx` — per-campaign cards with checkboxes; all pre-selected on first mount; back-navigation preserves selection; partial-fetch warning; "Select all / Select none" toggles

### Modified
- `app/api/meta/bulk-attach-ads/route.ts` — body shape changed from `metaCampaignIds` + runtime fetch to `campaignAdSets: Record<string, string[]>`; new validations: empty-array-per-campaign → 400, total-ads > 200 → 400; exports `TOTAL_ADS_CAP = 200`; adds `adSetIds` to `CampaignAttachResult`
- `app/api/meta/bulk-attach-ads/__tests__/route.test.ts` — 8 new tests (hard cap TOTAL_ADS_CAP, empty-array validation, 2-of-5 selection, total-ad cap); 13 original tests updated/preserved; 21 total passing
- `app/(dashboard)/events/[id]/bulk-attach/page.tsx` — 4-step flow (0: campaigns → 1: ad sets → 2: creatives → 3: review); actual ad count per cell in matrix; summary `N creatives × M campaigns = X ads`; validation blocking Continue if any campaign has 0 ad sets selected

## Validation

- [x] `npx tsc --noEmit` — no new errors
- [x] 38/38 tests pass (bulk-attach × 21 + prior PRs × 17)
- [ ] Manual: open bulk-attach flow on app.offpixel.co.uk → select 1 campaign → verify ad sets load pre-checked → uncheck some → launch → confirm only checked ad sets received ads in Meta Ads Manager
- [ ] Manual: navigate back from step 2 to step 1 → confirm selection is preserved
- [ ] Manual: uncheck all ad sets for one campaign → "Continue" button stays disabled
- [ ] Manual: check rate-limited partial load shows inline warning
- [ ] Squash-merge after Vercel preview green (base PR #544 must merge first)
