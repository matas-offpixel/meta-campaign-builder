# Session log

## PR

- **Number:** 404
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/404
- **Branch:** `cursor/creator/4thefans-rollup-pre-pr395-backfill`

## Summary

Adds a one-shot admin backfill route that corrects pre-PR-#395 `event_daily_rollups` rows
for 4theFans / foursomething events. Before PR #395 merged (~2026-05-08), the sync runner
wrote the provider's cumulative lifetime total into `tickets_sold` instead of the daily
delta, producing phantom spikes in trend charts (e.g. Manchester Croatia 2026-05-07
shows `242` when the real daily sale count is ~112). The backfill reconstructs correct
daily deltas from `ticket_sales_snapshots` using the existing multi-link-aware
`aggregateMultiLinkSnapshots` + `reconstructFourthefansRollupDeltas` helpers and
atomically updates every affected row with before/after audit output.

## Scope / files

- `app/api/admin/rollup-pre-pr395-backfill/route.ts` — new admin POST route
- `lib/ticketing/__tests__/fourthefans-rollup-backfill.test.ts` — 2 new tests for the
  pre-PR-395 backfill scenario (Manchester 242 spike, multi-link SUM)

## Validation

- [x] `npm test` — 9/9 pass (including 2 new scenario tests)
- [ ] `npx tsc --noEmit`

## Notes

- Auth: `Authorization: Bearer <CRON_SECRET>` — no user session required.
- Dry-run: `POST /api/admin/rollup-pre-pr395-backfill` with body `{ "dry_run": true }`
  returns rows_updated (preview) without writing.
- Overwrites ALL pre-2026-05-08 rows regardless of existing positive value (since the
  existing values are cumulative, not delta — they are by definition wrong).
- Post-run SQL verification: `SELECT date, tickets_sold FROM event_daily_rollups WHERE
  event_id = <Manchester Croatia> AND date BETWEEN '2026-04-01' AND '2026-05-07'` should
  show daily-delta values (0–30 range), NOT cumulative spikes of 200+.
