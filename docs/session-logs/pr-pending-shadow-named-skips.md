# Session log

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/shadow-named-skips`

## Summary

Named skip for campaigns with no rules, and honest `maintain` encoding. `mode=none` or zero enabled rules writes one campaign-level `skip_no_rules` row per tick (no per-ad-set rows, no insights fetch, no Slack). New ladders emit action `maintain` for the hold band; evaluate still accepts the legacy `decrease_budget`/`increase_budget` with `actionValue` 0.

## Scope / files

- `lib/optimisation/evaluate.ts` — `hasEnabledRules`, `skipNoRulesReason`, `isMaintainThreshold`
- `lib/optimisation/tick-runner.ts` — early campaign-level `skip_no_rules` before `fetchInsights`
- `lib/optimisation-rules.ts` / `lib/optimisation/presets.ts` — hold band action is `maintain`
- `lib/types.ts` — `RuleAction` includes `maintain`
- `lib/viz/tokens.ts` / `lib/plan/decisions-sheet.ts` — `skip_no_rules` renders as `·`
- `components/steps/optimisation-strategy.tsx` — ACTION_OPTIONS exhaustiveness

## Validation

- [x] `npm test` (5112 pass, 3 skipped)
- [x] `npm run build`

## Notes

Stacked on #887 (`cursor/shadow-cooldown-only-after-change`). `skip_no_rules` is not a budget-change action, so it does not start cooldown. Gates and apply.ts unchanged. No Meta writes.
