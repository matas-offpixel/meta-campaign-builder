# Session log

## PR

- **Number:** 836
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/836
- **Branch:** `cursor/rollup-tickets-leg-dead`

## Summary

Restore `event_daily_rollups.tickets_sold` after the July–August dead leg. Tickets now flow `ticket_sales_snapshots` → `collapseWeekly` (plus same-source listing sum) → daily rollup deltas. July–today backfilled through that same builder. Freshness alarm fires Slack `ads_urgent` (`rollup_tickets_dead`) when snapshots ingest and lifetime grows but every event's rollup tickets stay zero.

## Scope / files

- `lib/ticketing/rollup-tickets-from-snapshots.ts` — one collapse path for cron + backfill
- `lib/ticketing/rollup-tickets-freshness.ts` + `lib/db/rollup-tickets-freshness-load.ts` — dead-leg alarm
- `lib/dashboard/rollup-sync-runner.ts` — drop Eventbrite window zero-pad; write collapsed snapshots
- `app/api/cron/rollup-sync-events/route.ts` — alarm after Meta reconcile
- `lib/db/ticketing.ts` — `listAllSnapshotsForEvent`
- `scripts/backfill-rollup-tickets-from-snapshots.ts` — operator / this-PR backfill
- tests under `lib/ticketing/__tests__/`

## Validation

- [x] Regression test fails on `bf62984` (module missing) and passes on this branch
- [x] Named-event July+ rollup sums match collapse (Brighton 502, Kentish 0, Palace 454)
- [x] `npm test` — 4310 tests, 4307 pass, 0 fail, 3 skipped
- [x] `npx eslint` on changed files
- [x] `npm run build`

## Notes

- Structural break: tickets never read snapshots through collapse. Eventbrite 60-day zero-pad (`ae6ce1d` #99) walk-forward-overwrote the window; last nonzero prod rollup date was 2026-06-27.
- June commits on the path (`682641e`, `5439c78`, `9c76723`) do not invert `tickets_sold`.
- Same-source multi-link listings must be summed before collapse (Villa first backfill wrote 28,467 from listing bounce; corrected to 218).
