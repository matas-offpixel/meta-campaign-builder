# Session log — launch campaigns ACTIVE by default

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/launch-campaign-active-by-default`

## Summary

Changed the default `status` for campaigns, ad sets, and ads from `"PAUSED"` to `"ACTIVE"` at launch time. Previously, pressing "Launch" in the wizard created everything in Meta in a paused state, requiring a separate manual activation step in Ads Manager before any spend began. The new default means spend starts immediately on launch, which matches user intent ("I pressed Launch — go spend").

A `console.error` safety beacon in `buildAdSetPayload` logs `status=ACTIVE (spending begins on launch)` at every launch so there is always a Vercel log entry if anyone later questions why a campaign started spending.

## Scope / files

- `lib/meta/adset.ts` — `buildAdSetPayload`: `status: "PAUSED"` → `"ACTIVE"`, updated safety beacon log
- `lib/meta/creative.ts` — `buildAdPayload`: `status: "PAUSED"` → `"ACTIVE"`
- `app/api/meta/launch-campaign/route.ts` — campaign creation payload: `"PAUSED"` → `"ACTIVE"`, file-header comment updated
- `lib/meta/campaign.ts` — `CreateCampaignRequest.status` JSDoc updated
- `lib/meta/__tests__/launch-active-by-default.test.ts` — 2 regression tests

## Validation

- [x] `npx tsc --noEmit` — no new errors
- [x] `node --experimental-strip-types --test lib/meta/__tests__/launch-active-by-default.test.ts` — 2/2 pass

## Notes

- Type unions (`"PAUSED" | "ACTIVE"`) left intact — valid values can still be passed explicitly.
- Wizard / draft / save flow unchanged — only the Meta API payload at launch time changes.
- No UI toggle added. If an opt-out is ever needed, it should be a future explicit PR.
