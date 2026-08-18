## PR

- **Number:** 780
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/780
- **Branch:** `cursor/ig-explore-placement-deprecation`

## Summary

Meta deprecated IG Explore / Explore Home (code=100 subcode=2490589). Remove them from Step 5 UI defaults, keep the union for old drafts, and strip both positions in `buildPlacementConfigTargeting` so saved drafts cannot brick launches (IRW0001 Jamie Jones, 2026-08-18).

## Scope / files

- `components/steps/budget-schedule.tsx` — drop Explore UI options + seed values
- `lib/meta/placement-config.ts` — `DEPRECATED_IG_POSITIONS` launch backstop
- `lib/types.ts` — deprecation comments on union members
- `lib/meta/__tests__/manual-placement-default.test.ts` / `placement-config.test.ts`

## Validation

- [x] `node --test` manual-placement-default + placement-config
- [x] unit tests pass; no tsc issues expected in touched files

## Notes

- Checked `lib/meta/placements.ts` — does not emit explore; left untouched.
- Reproducer: IRW0001 Jamie Jones launch, all 9 ad sets failed 2026-08-18.
