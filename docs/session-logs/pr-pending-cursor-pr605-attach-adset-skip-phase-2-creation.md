# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/pr605-attach-adset-skip-phase-2-creation`

## Summary

In `attach_adset` mode, Phase 2 of `launch-campaign/route.ts` was seeding
synthetic ad-set keys for the picked live ad sets but then falling through to
`adSetCreationPromise` which was trying to create the wizard's locally-defined
ad sets in Meta. For CBO campaigns this caused error code=100 subcode=1885621
("You can only set an ad set budget or a campaign budget") because a per-ad-set
budget was being sent to Meta under a campaign that owns the budget. The fix
makes Phase 2 completely skip ad-set creation in attach_adset mode while
keeping Phase 3 (creatives) and Phase 4 (ads) unaffected.

## Scope / files

- `app/api/meta/launch-campaign/route.ts` — two changes:
  1. `standardSets` and `lookalikeSets` are both set to `[]` when
     `wizardMode === "attach_adset"` (prevents Phase 2b lookalike loop too)
  2. `adSetCreationPromise` IIFE returns immediately with a log line when
     `wizardMode === "attach_adset"`

## Audit

- `enabledSets` (line 385) = `draft.adSetSuggestions.filter(s => s.enabled)`.
  Always non-empty in attach_adset mode because Step 5 ad-set definitions
  remain in the draft. This is the source of the phantom ad-set creation.
- Phase 4 routing via `adSetMetaIds.get(internalAdSetId)` works correctly
  without Phase 2 running — synthetic keys seeded in the existing
  short-circuit (line 2258) are exactly what Phase 4 looks up.
- Secondary "Creative failed Invalid parameter" was a Phase 4 cascade: Phase 2
  left ad sets without Meta IDs, Phase 4 orphaned them. Fixed as a side effect.

## Validation

- [x] `npm run build` — passes, no type errors
- [ ] Vercel Preview: attach_adset × CBO campaign — no subcode=1885621
- [ ] Regression: attach_campaign / attach_all_adsets / new mode unaffected

## Notes

No lookalike ad-set creation is needed in attach_adset mode either: the picked
ad sets already exist in Meta with their targeting fully configured.
