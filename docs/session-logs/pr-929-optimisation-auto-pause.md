# Session log

## PR

- **Number:** 929
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/929
- **Branch:** `cursor/optimisation-auto-pause`

## Summary

The optimisation loop could scale budgets on its own and could not stop on its own. Pause is now a fourth-gated write: `ENABLE_OPTIMISATION_PAUSE_WRITES` on top of the existing three, reduce to `pauseFloorBudget` before any terminal pause, and three blast-radius limits (never the last active ad set, two pauses per run, 15-conversion minimum). Shipping the flag unset is the point. Never auto-resume.

## Scope / files

- `lib/optimisation/gates.ts` — `optimisationPauseDryRunGates` + env reader; 3-of-3 table unchanged
- `lib/optimisation/apply.ts` — pause path (floor, blast radius, persist, Slack-on-write)
- `lib/optimisation/tick-runner.ts` — two-pass ABO so campaign-wide is visible before any write
- `app/api/cron/optimisation-tick/route.ts` — wires fourth gate + `pauseAdSet` (`status: "PAUSED"` only)
- `lib/types.ts` — optional `pauseFloorBudget` (JSON guardrail, no migration)
- `lib/optimisation/evaluate.ts` — `GuardrailNote` union only; decision logic untouched
- `lib/plan/__tests__/drawer.test.ts` — freeze now allows the pause path + fourth gate, still diffs both files
- `CLAUDE.md`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5491 pass, 4 skipped)
- [x] Freeze test updated in the #923 shape; `lib/tiktok/write/**` untouched; no new frame baselines
- Local `frames:check` on Darwin diffs Ubuntu baselines (env/render, not this change). CI is the authority.

## Notes

- `ENABLE_OPTIMISATION_PAUSE_WRITES` is not set anywhere. Do not enable it in this PR.
- Slack §5: `ENABLE_SLACK_NOTIFICATIONS` is set in production; `SLACK_WEBHOOK_ADS_URGENT` is **unset**. The current pause path has been silently doing nothing on `ads_urgent`.
