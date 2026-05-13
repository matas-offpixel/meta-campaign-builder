# Session log

## PR

- **Number:** 403
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/403
- **Branch:** `cursor/creator/rollup-sync-today-zeros-investigation`

## Summary

Fixes a bug where every WC26 event's `event_daily_rollups` row for 2026-05-12 showed
`tickets_sold=0, revenue=0` despite `ad_spend` being non-zero. Root cause: when the
4theFans / foursomething API returns a lifetime total of 0 (due to a rate-limit, empty
body, or transient outage), `currentSnapshotDailyDelta` correctly clamps the delta to 0,
and the runner was writing that 0-delta row to today's rollup — corrupting the daily
tracker display. Fix adds a guard (`isSuspiciousTicketingZeroFetch`) that skips both the
snapshot insert and the rollup row write when the API returns a lower lifetime total than
the most-recent stored snapshot. The next successful cron run fills the gap.

## Scope / files

- `lib/dashboard/ticketing-zero-fetch-guard.ts` — new pure module with the guard
- `lib/dashboard/rollup-sync-runner.ts` — imports guard, applies it before snapshot insert
- `lib/dashboard/__tests__/rollup-sync-runner.test.ts` — 4 new test cases for the guard

## Validation

- [x] `npm test` — 14/14 pass (including 4 new guard tests)
- [ ] `npx tsc --noEmit`

## Notes

The guard is deliberately conservative: it only fires when `currentLifetime === 0` AND
`previousLifetime > 0`. A genuine first-sync zero (null previous) and a genuine equal-day
zero (previous also 0) are both allowed through.
