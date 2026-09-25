# Session log

## PR

- **Number:** 985
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/985
- **Branch:** `cursor/meta-ledger-archived-campaign`

## Summary

A `campaign_create` ledger hit was handing back an archived Meta campaign and logging it as created. SCHAK On Sale's relaunch reused `120251973029760755` and every ad set then failed 1487866. A ledger hit now re-fetches the campaign. Archived, deleted, or missing invalidates that row plus the draft's ad set and ad rows and creates a new campaign. A live campaign with the same objective is reused and the launch line says reused. A live campaign whose objective no longer matches is refused. 1487866 maps to an archived-campaign message that names the id. No migration: dead rows are deleted.

## Scope / files

- `lib/meta/campaign-ledger.ts` — liveness wrapper around the ledger
- `lib/meta/write-idempotency.ts` — delete the dead campaign row and dependent ad set / ad rows
- `app/api/meta/launch-campaign/route.ts` — Phase 1 calls the wrapper; one extra GET
- `components/steps/review-launch.tsx` — reused / recreated labels
- `lib/meta/launch-error-classify.ts` — 1487866
- `lib/types.ts` — `campaignCreateOutcome`

## Validation

- [x] `npm test` — 6323 tests, 6319 pass, 4 skipped, 0 fail (round 2)
- [x] `npm run build` — compiled
- [ ] CI check-run conclusions for round 2 (reported in the thread, not committed)

## Notes

No `invalidated_at`. Creative upload rows are kept. Attach-mode checks were not changed.

## Round 2

A null from `fetchCampaignById` is every Graph failure, not just a missing campaign. The ledger re-fetch is `fetchCampaignByIdForLedger`, which throws. Only ARCHIVED, DELETED, code 100 / subcode 33, and code 803 recreate. Subcode 33 is logged as `not_found_or_no_permission`. A rate limit returns the existing 429. Any other re-fetch error is a 502 (`Failed to verify the stored campaign … Retry the launch.`) and the ledger row stays. `fetchCampaignById` still returns null for the attach path.
