## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `fix/4thefans-tottenham-matching-and-auto-select-threshold`

## Summary

Fixes Tottenham link discovery by moving auto-select eligibility into the matcher, requiring both overall confidence and venue confidence, and adding Tottenham venue-alias regression coverage.

## Scope / files

- Adds `autoSelect` to match candidates with score >= 0.65 and venue score >= 0.65
- Adds matcher logging for auto-select decisions
- Threads `autoSelect` through the discovery API and UI
- Extends venue variants to handle dash-separated trailing locations as well as comma-separated ones
- Adds Tottenham / Club360 regression tests for Croatia, Ghana, Panama, and Last 32

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "lib/ticketing/link-discovery.ts" "app/api/clients/[id]/ticketing-link-discovery/route.ts" "components/dashboard/clients/ticketing-link-discovery.tsx" "lib/ticketing/__tests__/link-discovery.test.ts"`
- [x] `node --test lib/ticketing/__tests__/link-discovery.test.ts`

## Notes

Could not live-probe 4thefans event IDs 4012 / 4206 / 4218 / 4239 from this worktree because no usable 4thefans token was present in the shell environment. The regression tests cover the expected venue shapes: `Club360, Tottenham` and `Tottenham, Club360`.
