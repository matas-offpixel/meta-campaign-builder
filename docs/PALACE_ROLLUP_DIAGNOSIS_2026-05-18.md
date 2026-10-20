# Palace rollup NULL-on-13-17-May diagnosis

## Initial hypothesis (REFUTED)
- Per-link skip-noop bug in PR #409
- Refuted: PR #409 guard is per-(event_id, date) on merged total, AFTER all links summed via `mergeDailyTicketsRow` at `rollup-sync-runner.ts:889`

## Actual root cause
- Two-cron architectural split:
  * `/api/cron/sync-ticketing` (every 4h) writes ONLY `ticket_sales_snapshots`
  * `/api/cron/rollup-sync-events` (3×/day) writes `event_daily_rollups` via `runRollupSyncForEvent`
- Ticketing leg of `rollup-sync-events` has NO historical-window backfill — writes only `todayStr` per `fetchFourthefansRollupSnapshotContribution` at `rollup-sync-runner.ts:1361-1367`
- If a single day's cron run misses Palace (skipped, threw mid-event, or both per-link deltas were 0), that day's `tickets_sold` is permanently NULL
- NULL ≠ 0, so the meta-created row stays NULL forever

## Data evidence
- Palace `event_id` `d1a84735-8531-417f-bc3b-a15196bdbf7f`
- Snapshots populated 5/13–17 (`sync-ticketing` kept running)
- `event_daily_rollups.tickets_sold` NULL for 5/13–17 (`rollup-sync-events` ticketing leg never wrote those days)
- `tier_channel_sales` SUM = 256 (correct lifetime: link 21825 = 127 + link 18128 = 129)
- `event_daily_rollups` SUM 5/8–18 = 163 (93-ticket gap unrecoverable from rollups)
- Vercel runtime logs only retain 24h — can't recover 5/13–17 invocation history for forensic root cause

## Why patching the rollup writer is the wrong fix
- Even a perfect writer can't reconstruct historical NULL days — snapshot timestamps don't preserve when growth actually occurred within a day
- Daily-delta approach is structurally lossy: cron at irregular intervals against snapshots growing continuously folds N days of growth into whichever day's cron caught the increment
- Patching the writer leaves Manchester 1,770 vs 461 (same shape bug) undiagnosed
- Doesn't generalise — every event with a missed cron day has unrecoverable NULL rollups

## Recommended fix (architectural)
Extend `getCanonicalEventMetrics` to source tickets from `tier_channel_sales` as authoritative lifetime per `(event, tier, channel)`. For per-day breakdowns, derive from `tier_channel_sales_daily_history` (migration 089). The rollup `tickets_sold` field becomes diagnostic-only, not the read source.

This matches the Cat F resolution shape: canonical resolver routes through authoritative source (cache for reach, `tier_channel_sales` for tickets), not leg-specific aggregations.

## Surfaces affected (all currently reading `event_daily_rollups.tickets_sold`)
- Trend chart (`lib/dashboard/...`)
- Funnel Pacing "Purchases" tile (`lib/reporting/funnel-pacing.ts`)
- Daily Tracker rows (`components/share/venue-daily-report-block.tsx`)
- Attribution gap tile (the PR-in-flight from another thread)

Venue card "Tickets sold" tile + Stats Grid already read `tier_channel_sales` (correct).

## Next steps (separate work, NOT this PR)
1. Open Cursor Sonnet PR to extend `getCanonicalEventMetrics` with tickets resolution
2. DOM-level regression tests pinning Manchester=1,770, Palace=256
3. Verify `tier_channel_sales_daily_history` has the per-day per-link data needed for daily-delta surfaces

## Reference
- `project_creator_4thefans_diagnostic_2026-05-18.md` (live data state)
- `project_creator_canonical_event_metrics_shipped.md` (Cat F resolution pattern)
- `feedback_snapshot_source_completeness.md` (`tier_channel_sales` authoritative)
