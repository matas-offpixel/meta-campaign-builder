## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `fix/4thefans-auto-select-best-match`

## Summary

Fixes link discovery selection so high-confidence candidates are pre-selected for review instead of requiring row-by-row checks, and lowers the auto-confirm score threshold while keeping the venue guard.

## Scope / files

- Link discovery auto-confirm threshold lowered to 0.75 with venue score still required at 0.80
- Auto-select threshold added at 0.65 in the client discovery UI
- "Auto-link all" now selects best matches for review rather than immediately persisting
- Discovery summary shows auto-matched, needs-review, and no-candidate counts
- Candidate dropdown added per event row for manual selection changes
- Regression tests for Central Park auto-confirm and low-confidence surfaced review candidates

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "lib/ticketing/link-discovery.ts" "components/dashboard/clients/ticketing-link-discovery.tsx" "lib/ticketing/__tests__/link-discovery.test.ts"`
- [x] `node --test lib/ticketing/__tests__/link-discovery.test.ts`
