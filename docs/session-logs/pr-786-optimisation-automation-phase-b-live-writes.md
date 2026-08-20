# Session log

## PR

- **Number:** 786
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/786
- **Branch:** `cursor/optimisation-automation-phase-b-live-writes`

## Summary

PR B of task #120: `/api/cron/optimisation-tick` can now apply `scale_up` /
`scale_down` to Meta `daily_budget`, still using `evaluate.ts` as the only
decision function. Writes require three-of-three
(`ENABLE_OPTIMISATION_WRITES` + `optimisation_automation_enabled` +
`optimisation_automation_live`). Pause stays recommend-only. Missing Step 6
guardrails (`maxSingleAdSetBudget`, `maxDailyIncreasePercent`) are wired.
Cooldown counts from `applied_at`. Blast-radius cap is 25 writes/run.

## Scope / files

- `supabase/migrations/154_optimisation_automation_live.sql` (applied to prod)
- `lib/optimisation/gates.ts` + 8-row truth table tests
- `lib/optimisation/evaluate.ts` — new guardrail clamps only
- `lib/optimisation/apply.ts` — executor (re-read, write, pause-never, underfoot)
- `lib/optimisation/tick-runner.ts` — counters, cooldown, cap, Slack summary
- `lib/db/optimisation-decisions.ts` + `campaign-automation-decisions.ts`
- `app/api/cron/optimisation-tick/route.ts`
- `CLAUDE.md`

## Validation

- [x] Migration 154 applied (`optimisation_automation_live boolean default false` + partial index)
- [x] `node --conditions react-server --experimental-strip-types --test lib/optimisation/__tests__/{gates,evaluate,apply,tick-runner}.test.ts` — 54 pass
- [ ] First live subject still needs a deliberate SQL flip:
      `update campaign_drafts set optimisation_automation_live = true where id = 'c3b471bb-f80a-49fa-bad2-6b2b27551055'`
      plus `ENABLE_OPTIMISATION_WRITES=1` on Vercel. Not done in this PR.

## Notes

- No UI toggle for `optimisation_automation_live` (PR C).
- Until a campaign has a successful write, live cooldown ignores shadow
  `decided_at` so PR A rows cannot block the first real write.
