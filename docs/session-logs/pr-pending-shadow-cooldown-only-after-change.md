# Session log

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/shadow-cooldown-only-after-change`

## Summary

Cooldown starts only from a decision that would change budget (`scale_up` / `scale_down` / `pause`), applied or dry-run. maintain, skip_*, insufficient_conversions, and metric_unavailable no longer start or extend the 168h conversion cooldown, so the six silent campaigns evaluate on the next tick with no data migration.

## Scope / files

- `lib/optimisation/evaluate.ts` — `isBudgetChangeAction`, `lastChangeDecidedAt`
- `lib/db/optimisation-decisions.ts` — last decided row is last CHANGE only
- `lib/optimisation/tick-runner.ts` — comments; still uses `resolveLastTouchedAt`
- `lib/db/campaign-automation-decisions.ts` — unused helper filtered the same way
- `lib/plan/__tests__/drawer.test.ts` — write-path guard narrowed to gates/apply

## Validation

- [x] `npm test` (5108 pass, 3 skipped)
- [x] `npm run build`

## Notes

Gates and apply.ts unchanged. No Meta writes.
