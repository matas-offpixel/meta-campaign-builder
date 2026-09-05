# Session log template

Copy to `docs/session-logs/pr-{number}-{branch-slug}.md` (use `pr-pending-{branch-slug}.md` until the PR exists).

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/plan-v2-fix-now`

## Summary

Fix-now PR for plan v2 bugs that mislead today (canon §6 G7, G8, G11, G12, G14 + revamp §7 minus signups). No token changes, no new primitives, no `evaluate.ts` edits.

## Scope / files

- Channel-row live facts → `formatCurrency` (`£4.21 per thousand · £0.09 per click`)
- Decisions sheet G7/G8 — collapse no-reading rows; dashed + `count unavailable` when a change has no evidence count
- `/plans` dates via `formatVizDay`; `£40 per day`
- `fanoutOff` operator sentence beside the button; `ENABLE_PLAN_FANOUT` only in the ⓘ
- AspectChip: ratio or `—`, never `OTHER`
- Window validation without rewriting stored dates; honest empty + Launch disabled
- Failed asset thumbs: dashed slot + filename
- TikTok/Google unset identity chips in their words

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5122 pass, 3 skipped)

## Notes

No token changes. Signups (canon G1) and target-unit-by-phase were out of scope.
