# Session log

## PR

- **Number:** 929
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/929
- **Branch:** `cursor/optimisation-auto-pause`

## Summary

The optimisation loop could scale budgets on its own and could not stop on its own. Pause is now a fourth-gated write: `ENABLE_OPTIMISATION_PAUSE_WRITES` on top of the existing three, reduce to `pauseFloorBudget` before any terminal pause, and three blast-radius limits (never the last active ad set, two pauses per run, 15-conversion minimum). Shipping the flag unset is the point. Never auto-resume.

Round 2: the floor cut sat above those three guards and spent the generic write budget. Conversion minimum, last-active, and the pause cap now run first. Campaign-wide is a majority of the same delivering set. Floor cuts draw from the two-pause budget.

## Scope / files

- `lib/optimisation/gates.ts` — `optimisationPauseDryRunGates` + env reader; 3-of-3 table unchanged. Tick-runner now calls the helper.
- `lib/optimisation/apply.ts` — pause path (floor behind the guards; majority campaign-wide)
- `lib/optimisation/tick-runner.ts` — two-pass ABO; both counters over fetched delivering rows; pause writes do not increment `writesApplied`
- `app/api/cron/optimisation-tick/route.ts` — wires fourth gate + `pauseAdSet` (`status: "PAUSED"` only)
- `lib/optimisation/insights-fetch.ts` — already requested `effective_status`; comment names it as the blast-radius linchpin
- `lib/types.ts` — optional `pauseFloorBudget` (JSON guardrail, no migration)
- `lib/optimisation/evaluate.ts` — `GuardrailNote` union only; decision logic untouched
- `lib/plan/__tests__/drawer.test.ts` — freeze asserts the scale path and 3-of-3 are byte-identical to main
- `CLAUDE.md`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5499 pass, 4 skipped)
- [x] Freeze: scale write path + `optimisationDryRunGates` match main; `status: "ACTIVE"` absent from `apply.ts` and the cron route
- Local `frames:check` on Darwin diffs Ubuntu baselines (env/render, not this change). CI is the authority.

## Notes

- `ENABLE_OPTIMISATION_PAUSE_WRITES` is not set anywhere. Do not enable it in this PR.
- `evaluate.ts` ceiling / `maxDailyIncreasePercent` clamps do not apply to the floor cut. Intended: the floor is a configured stop, not a scale-down through the ladder.
- `effective_status` is on the ad-set Graph field list and mapped onto every insight row. Missing status is not delivering; after round 2 that also blocks the floor cut (`active <= 1`).
- Slack: `SLACK_WEBHOOK_ADS_URGENT` is now configured. One live check that a message arrives belongs before the flag is flipped, not before merge.
