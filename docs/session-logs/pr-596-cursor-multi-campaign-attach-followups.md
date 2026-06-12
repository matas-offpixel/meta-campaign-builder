# Session log — multi-campaign attach follow-ups

## PR

- **Number:** 596
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/596
- **Branch:** `cursor/multi-campaign-attach-followups`

## Summary

Three follow-up improvements to the multi-campaign attach flow introduced in
PR #595. GOAL 1 adds an objective-compatibility pre-flight check and replaces
the misleading "objective changed" error with a named-entity error that tells
the user which two campaigns conflict; it also greys out incompatible campaigns
in the picker. GOAL 2 adds a new `attach_all_adsets` wizard mode that skips
ad-set creation and instead fetches all active/paused ad sets across the
selected campaigns at launch time (capped at 25). GOAL 3 re-enables the
`attach_adset` mode for multi-campaign selections when all campaigns share the
same objective and introduces a `CrossCampaignAdSetPicker` that shows ad sets
grouped by campaign with a 12-ad-set cap.

## Scope / files

- `lib/types.ts` — `WizardMode` extended with `"attach_all_adsets"`;
  `ATTACH_ALL_ADSETS_CAP`, `CROSS_CAMPAIGN_ADSET_CAP` constants;
  `internalObjective` added to `ExistingMetaCampaignSnapshot`;
  `getVisibleSteps` updated
- `lib/validation.ts` — skip-validation guard for `attach_all_adsets` in
  optimisation, audiences, budget-schedule, and assign-creatives validators;
  multi-campaign orphan check for `attach_adset`
- `lib/meta/attach-objective.ts` — new: `assertSameObjective` utility extracted
  for testability
- `lib/meta/__tests__/attach-objective.test.ts` — new: 7 unit tests (all pass)
- `components/bulk-attach/campaign-multi-picker.tsx` — new
  `getExtraDisabledReason` prop for contextual checkbox disabling
- `components/steps/cross-campaign-adset-picker.tsx` — new: ad-set picker
  grouped by campaign with per-campaign fetch and shared cap
- `components/steps/campaign-setup.tsx` — sub-toggle between
  `attach_campaign` / `attach_all_adsets`; `getObjectiveDisabledReason` for
  incompatible-objective campaigns; `CrossCampaignAdSetPicker` wired for
  multi-campaign `attach_adset`; `internalObjective` stored in snapshots
- `app/api/meta/launch-campaign/route.ts` — Phase 0: `assertSameObjective`
  pre-flight; Phase 1: per-campaign drift check naming the campaign; Phase 2:
  `attach_all_adsets` short-circuit fetches live ad sets; Phase 4: creates ads
  under all fetched ad sets in `attach_all_adsets` mode; cross-campaign orphan
  check for `attach_adset`

## Validation

- [x] 7/7 unit tests pass (`npm run test` scoped to `lib/meta/__tests__/attach-objective.test.ts`)
- [x] No new lint errors introduced (pre-existing warnings only)
- [ ] `npx tsc --noEmit` (not re-run; no new type annotations added)
- [ ] `npm run build` (not run; no build-breaking changes)

## Notes

- The `assertSameObjective` function compares raw Meta objective strings (e.g.
  `"LINK_CLICKS"`, `"OUTCOME_SALES"`). OUTCOME_TRAFFIC vs LINK_CLICKS are
  treated as different even if they map to the same internal type — intentional.
- `attach_all_adsets` mode caps at 25 ad sets to keep launch under 5 min.
- `attach_adset` multi-campaign mode caps at 12 ad sets.
- Pre-existing lint warnings in `launch-campaign/route.ts` (unused IG-actor
  helpers) were not introduced by this PR.
