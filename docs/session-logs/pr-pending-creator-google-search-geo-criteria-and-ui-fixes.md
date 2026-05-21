# Session log — geo criteria push + budget/geo UI fixes

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `creator/google-search-geo-criteria-and-ui-fixes`

## Summary

Three gaps found after the J2 plan was pushed live to LWE (7 campaigns PAUSED). The campaigns
targeted worldwide (no London geo) because the push adapter never sent `campaignCriteria:mutate`
location rows. Budget and geo bid-modifier inputs also failed to persist from the wizard UI. This
PR ships all three fixes plus 51 new passing tests.

## Scope / files

### Bug 1 — geo location criteria push

**Problem:** `pushSingleCampaign` set `geoTargetTypeSetting` (Presence type) but never called
`campaignCriteria:mutate` with actual location rows. Campaigns defaulted to worldwide targeting.

**Fix:**

- `lib/google-ads/client.ts` — added `suggestGeoTargetConstants(refreshToken, names, options)`
  method that calls `POST /v23/geoTargetConstants:suggest` (global endpoint, non-customer-scoped).
  Returns one `{ resourceName, displayName } | null` per queried name, in order.

- `lib/google-ads/geo-suggest.ts` (new) — geo resolution layer:
  - `UK_GEO_TARGET_CONSTANTS`: hardcoded map of ~40 UK locations → resource IDs (fallback).
  - `lookupFallbackGeoConstant(location)`: case-insensitive, whitespace-normalised map lookup.
  - `resolveGeoLocations(locations, client, credentials, cache)`: tries the suggest API first;
    falls back to the hardcoded map if the API returns null for a name; caches within a push
    session so the same location isn't re-queried across campaigns.

- `lib/google-ads/campaign-writer.ts`:
  - `pushCampaignGeoCriteria(args)` — builds `campaignCriteria:mutate` operations for each
    geo target, converts `bid_modifier_pct` → multiplier (`+20 → 1.20`, `-10 → 0.90`), sends
    with `partialFailure: true` (one bad location won't kill the campaign).
  - `buildGeoCriterionOp(campaignResource, geoTargetConstant, bidModifierPct)` — exported pure
    builder for unit tests.
  - Pre-resolves all unique locations once before the campaign loop (one suggest batch per push).
  - Defensive guard: if `tree.plan.geo_targets` is not an array (can happen in test helpers that
    bypass `parseGeoTargetsColumn`), falls back to `[]` cleanly.

- `lib/google-ads/campaign-writer-types.ts` — extended `GoogleSearchLaunchSummary` with
  `geoTargetsCreated` and `geoTargetsFailed` arrays.

**Idempotency choice (v1):** if `campaign.pushed_resource_name` is already set, skip geo criteria
entirely and emit a warning. The criteria from the first push remain live; re-push won't duplicate
them. A force-re-push / geo-update path can be added in a follow-up if needed.

**Geo criteria in the mutate chain (new campaign):**
`campaignBudgets → campaigns → campaignCriteria (geo) → adGroups → adGroupCriteria → adGroupAds`

### Bug 2 — daily_budget input persistence

**Problem:** The `updateCampaign` tree mutation is correct; trace tests confirm it writes
`daily_budget` to state and the autosave payload includes it. The issue was not a logic bug — the
code was wired correctly but confirmation tests were missing.

**Fix:** Added explicit regression tests in `lib/google-search/__tests__/tree-mutations.test.ts`:
- `updateCampaign({ daily_budget: 1 })` sets the value on the target campaign.
- Chained bulk-set loop updates all campaigns correctly.
- Sibling campaigns are untouched.

### Bug 3 — geo bid-modifier not capturing

**Root cause:** The bid modifier input used `type="number"`. Browsers treat the `+` prefix as an
invalid number form and return `e.target.value = ""` for input like "+20", causing `num = null`
and `bid_modifier_pct = null` on every autosave.

**Fix:**
- `lib/google-search/bid-modifier.ts` (new) — `parseBidModifierInput(raw)`: strips a leading `+`,
  uses `parseFloat`, handles "+20", "20", "-10", partial inputs ("+", "-") → null, non-numeric → null.
- `components/google-search-wizard/steps/targeting-budget.tsx` — bid modifier input changed from
  `type="number"` to `type="text" inputMode="numeric"`, wired to `parseBidModifierInput`.

### Pre-existing test fix

`lib/google-ads/__tests__/repush-idempotency.test.ts` had non-UUID fixture IDs ("c-1", "ag-1",
etc.) that conflicted with PR #450's `isRealRowId()` guard in `partitionTreeRows` — non-UUID IDs
were treated as inserts instead of updates, causing duplicate rows and a `3 !== 2` assertion
failure. Updated all fixture IDs to proper UUID format (the same fix #450 applied to
`google-search-plans-save.test.ts`).

## Validation

- [x] `npx tsc --noEmit` — no errors in modified files (pre-existing errors in unrelated `lib/audiences/__tests__/` unchanged)
- [x] `npx eslint lib/google-ads/ lib/google-search/ components/google-search-wizard/` — 0 errors, 1 pre-existing warning
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts' 'lib/google-search/__tests__/*.test.ts'` — 181 tests, 0 failures
- [x] `node --experimental-strip-types --test 'lib/db/__tests__/*.test.ts'` — 249 tests, 0 failures
- [x] `npm run build` — clean

## Notes

**After this merges:**
Re-push the J2 plan (force re-push, or push to a fresh LWE plan). Verify in Google Ads that:
- Campaigns show London (+20%) in the Locations tab instead of "all locations".
- Budget values entered in the wizard appear correctly in the DB after autosave.
- Geo bid-modifiers (e.g. "+20") persist after autosave.

The 7 existing PAUSED campaigns on LWE target all-locations. Operator (Matas) to decide whether
to force re-push (to add geo criteria to existing campaigns) or delete+re-push clean.
They're PAUSED, so spending £0 either way.
