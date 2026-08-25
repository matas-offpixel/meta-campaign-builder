# Session log

## PR

- **Number:** 834
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/834
- **Branch:** `cursor/tiktok-rollback-delete-endpoint`

## Summary

Failed-launch rollback was POSTing `/campaign/delete/`, which is not in the official SDK and has 404'd on every production failure. Cleanup now uses `POST /campaign/status/update/` with `operation_status: DELETE`. A failed cleanup appends the orphan campaign id to the launch error so the operator can delete it in Ads Manager.

## Scope / files

- `lib/tiktok/write/orchestrator.ts` — status-update delete + orphan message
- `lib/tiktok/__mocks__/client.ts` — mock the documented path
- `lib/tiktok/__tests__/write-foundation.test.ts` — path/method + orphan + idempotency

## Validation

- [x] Targeted write-foundation + launch-route tests
- [x] eslint on changed files — clean
- [x] `npm run lint` — 27 errors / 111 warnings, all pre-existing (none in this PR)
- [x] `npm run build` — clean
- [x] `npm test` — 4296 pass / 0 fail / 3 skipped (main `b6de66b` suite is already gated; no 13-fail leftover)

## Notes

- SDK source: `CampaignCreationApi.campaign_status_update` → `POST /open_api/v1.3/campaign/status/update/` (`CampaignStatusUpdateBody`: `advertiser_id`, `campaign_ids`, `operation_status`). There is no `/campaign/delete/`. Java README: "Enable, disable or delete a campaign." `DELETE` matches the ENABLE/DISABLE create enum.
- Official docs do not say whether deleted campaign names stay reserved. Measured collisions are from live orphans (delete never succeeded). If a successful DELETE still blocks #804, names are reserved and retry means rename.
