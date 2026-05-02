## PR

- **Number:** 258
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/258
- **Branch:** `fix/4thefans-revenue-deltas-and-zero-pad-skip`

## Summary

Fixes the remaining current-snapshot rollup issues after PR #255: 4thefans revenue now writes as a daily delta, and pre-delta historical zero ticket/revenue rows are nulled so the Daily Tracker renders them as unknown.

## Scope / files

- Computes `delta_revenue` from current 4thefans lifetime revenue minus the latest prior same-source revenue snapshot
- Keeps raw lifetime tickets/revenue in `ticket_sales_snapshots` for cumulative history
- Allows current-snapshot rollup revenue to be `null` when a provider does not expose revenue
- Cleans historical ticketing-owned zero/zero rows before the first positive current-snapshot daily rollup
- Adds migration `069_clear_4thefans_pre_delta_zero_padding.sql` to repair existing production rows
- Expands current-snapshot delta regression tests for revenue

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "lib/dashboard/rollup-sync-runner.ts" "lib/db/ticketing.ts" "lib/db/event-daily-rollups.ts" "lib/ticketing/current-snapshot-delta.ts" "lib/ticketing/__tests__/current-snapshot-delta.test.ts"`
- [x] `node --test lib/ticketing/__tests__/current-snapshot-delta.test.ts lib/ticketing/__tests__/fourthefans-provider.test.ts`

## Notes

Expected Vercel log shape after deploy:

```text
[fourthefans-sync] delta event_id=<event-id> external_event_id=<4tf-id> current_tickets=1731 previous_tickets=1648 delta_tickets=83 current_revenue=16351.00 previous_revenue=15420.00 delta_revenue=931.00
```

Tier 7 venue-report game/tier visibility is intentionally left for a follow-up PR because it adds new venue report UI and 4thefans tier parsing.
