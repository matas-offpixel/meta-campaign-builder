# Session log — IG actor validated re-add

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/ig-actor-validated-readd`

## Summary

Fixes Meta `code=100 subcode=1772103` ("Select an Instagram account or Facebook Page") for new-ad creatives targeting Instagram placements. Root cause (from PR #562 audit): commit `b57a98e` removed `instagram_actor_id` from `buildLinkCreative` / `buildVideoCreative` to avoid a different `#100` unauthorised-actor error, leaving all creatives page-only. Re-adds the field conditionally via a validated gate: `createIgActorValidator` calls `GET /act_{adAccountId}/instagram_accounts` once per launch, caches the authorised list, and returns the actor id only when confirmed. Both route handlers (`launch-campaign`, `bulk-attach-ads`) pre-validate before calling `buildCreativePayload`, passing `validatedIgActorId` into the builders. Accounts where the IG actor is not in the authorised list fall back to page-only without throwing.

## Scope / files

- `lib/meta/ig-actor-validator.ts` — new: validator factory with single-fetch per-launch cache
- `lib/meta/creative.ts` — `buildCreativePayload` opts param; `buildLinkCreative`, `buildVideoCreative`, `buildMultiPlacementCreative` each accept and apply `validatedIgActorId`
- `app/api/meta/launch-campaign/route.ts` — import + validator creation + per-creative resolve before `buildCreativePayload`
- `app/api/meta/bulk-attach-ads/route.ts` — same
- `lib/meta/__tests__/creative-ig-identity-regression.test.ts` — updated from RED to GREEN; now covers case A (validated), B (unvalidated → page-only), C (no IG account)
- `lib/meta/__tests__/ig-actor-validator.test.ts` — new: 6 unit tests (authorised, unauthorised, HTTP error, network error, cache hit, empty id)

## Validation

- [x] No tsc errors in touched files
- [x] 11 tests pass (regression + validator)
- [x] No lint errors

## Notes

- The `/instagram_accounts` fetch uses `limit=100`. Accounts with > 100 linked IG actors (extremely rare for event-marketing ad accounts) would need pagination; deferred as not a realistic risk.
- `ENABLE_MULTI_PLACEMENT_ASSETS` flag-ON path (`buildMultiPlacementCreative`) is also fixed: it shares the same `validatedIgActorId` opt thread.
- Post-merge manual validation targets: Aberdeen WC26 3 ads (known-good account → should go GREEN); Back Of House ads (unknown IG auth state → logs should show graceful page-only if actor not in list).
