# Session log — ad-set effective_status filter fix (PR A)

## PR

- **Number:** #722
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/722
- **Branch:** `cursor/creator/wizard-adset-status-filter-fix`

## Summary

Fixes the 2026-07-15 live bugs where the main wizard's "Add to existing ad
set(s)" picker and `attach_all_adsets` launch-time fetch only surfaced ad sets
that were paused at their own level, silently dropping ad sets configured
`status: "ACTIVE"` whose parent campaign happened to be paused. Meta reports
those as `effective_status: "CAMPAIGN_PAUSED"` (not `"ACTIVE"`), and Meta can
similarly report `"ADSET_PAUSED"` / `"WITH_ISSUES"` for ad sets that are
otherwise configured on. None of those three values were in
`fetchAdSetsForCampaign`'s `effective_status` allow-list, so:
- Selecting multiple campaigns in `attach_all_adsets` mode silently
  contributed zero ad sets for any paused campaign in the selection
  (looked like "doesn't span multiple campaigns").
- The single-campaign "Add to existing ad set" picker only ever showed
  ad sets that were individually paused.

Full root-cause analysis: `docs/session-logs/pr-pending-cursor-creator-wizard-three-bug-diagnose-fix.md`
(on the diagnosis branch `cursor/creator/wizard-three-bug-diagnose-fix`).

## Scope / files

- `lib/meta/adset-effective-status-filter.ts` — **new**. Pure helper
  (`effectiveStatusAllowListFor`) extracted so it's unit-testable without
  importing `lib/meta/client.ts` (whose `MetaApiError` class uses TS
  parameter properties — unsupported under this repo's
  `node --experimental-strip-types` test runner).
- `lib/meta/client.ts` — `fetchAdSetsForCampaign` now delegates to
  `effectiveStatusAllowListFor` instead of inlining the allow-lists.
  `"relevant"` and `"active"` now include `CAMPAIGN_PAUSED`, `ADSET_PAUSED`,
  `WITH_ISSUES` alongside the pre-existing `ACTIVE`/`PAUSED`. `"paused"` is
  unchanged (literal ad-set-own-PAUSED only). Used by both
  `/api/meta/adsets` (main wizard picker) and the `attach_all_adsets`
  launch-time fetch — both consumers inherit the fix automatically since
  they already call through this shared helper.
- `app/api/meta/launch-campaign/route.ts` — comment-only update at the
  `attach_all_adsets` Phase 2 fetch site noting the inherited fix.
- `lib/meta/__tests__/adset-cascading-status-filter.test.ts` — **new**, 6
  cases covering all four filter modes + the "ad set nested under a paused
  campaign" scenario from the live bug report.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build` — exit 0
- [x] `npm run lint` — 0 errors on touched files (5 pre-existing unrelated
      warnings in `launch-campaign/route.ts`, unchanged by this diff)
- [x] `node --test lib/meta/__tests__/adset-cascading-status-filter.test.ts` — 6/6 passing
- [x] `node --test lib/meta/__tests__/*.test.ts` — 265/266 passing; the one
      failure (`creative-buy-tickets-cta.test.ts`) is a pre-existing,
      env-var-dependent failure confirmed present on `main` before this
      change (unrelated — `ENABLE_MULTI_PLACEMENT_ASSETS` not set in the
      local test shell).

## Notes

Deliberately did not add `CASCADING_PAUSE_STATUSES` to the `"paused"` filter
branch — that bucket is meant to mean "this ad set's own toggle is off",
which is a distinct concept from "the ad set is on but suppressed by
something else." `"relevant"` and `"active"` are the two buckets that needed
the fix (both represent "is this ad set something I could add ads to /
expect to be delivering").
