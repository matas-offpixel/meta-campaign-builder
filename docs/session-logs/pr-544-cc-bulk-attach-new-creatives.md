# Session log — bulk-attach new creatives

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/bulk-attach-new-creatives`

## Summary

Adds a bulk-attach flow so new creatives can be uploaded once and dropped across multiple existing live Meta campaigns in a single operation. Previously each campaign required a separate "Open campaign creator" → attach workflow. Now the user can multi-select up to 8 campaigns, upload creatives once, and the system creates one Meta creative per campaign (reused across all ad sets in that campaign) and one ad per ad set — all ACTIVE immediately.

## Scope / files

### New
- `app/api/meta/bulk-attach-ads/route.ts` — `POST /api/meta/bulk-attach-ads`; serial campaign execution, 1s sleep between campaigns, 8-campaign hard cap, `classifyLaunchMetaCode`-aware rate-limit handling, 600s `maxDuration`
- `app/api/meta/bulk-attach-ads/__tests__/route.test.ts` — 13 tests: hard cap, rate-limit classifier, ad payload construction, serial count
- `components/bulk-attach/campaign-multi-picker.tsx` — multi-select campaign picker (checkboxes, parent-managed `Set<campaignId>` survives Load More)
- `app/(dashboard)/events/[id]/bulk-attach/page.tsx` — 3-step page: Select campaigns → Configure creatives → Review & launch + per-campaign result summary

### Modified
- `components/dashboard/events/event-detail.tsx` — "Bulk attach creatives" button alongside "Open campaign creator"; passes `adAccountId` from `event.client.meta_ad_account_id` as URL param

## Validation

- [x] `npx tsc --noEmit` — no new errors
- [x] 30/30 tests pass (bulk-attach + prior PRs)
- [ ] Manual: multi-select 2 campaigns on app.offpixel.co.uk → upload one image → launch → confirm ads appear ACTIVE in both campaigns' ad sets in Meta Ads Manager
- [ ] Manual: attempt 9-campaign selection → confirm "Continue" stays disabled (UI cap) + attempt API call → confirm 400 with hard-cap message

## Architecture notes

- One Meta creative created per asset per **campaign** (not per ad set) — Meta allows one creative to attach to N ads in the same account. This minimises API calls and avoids rate-limit pressure.
- The existing single-campaign wizard (`CampaignPicker`, `launch-campaign` route) is untouched. `CampaignMultiPicker` is a NEW additive component.
- ACTIVE-by-default is inherited from the codebase default (PRs #540/#541); the bulk-attach route does not override it.
