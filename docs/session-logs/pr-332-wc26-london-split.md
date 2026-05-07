# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `thread/wc26-london-split`

## Summary

Implements the WC26 London 3-way spend-split for the two shared umbrella
campaigns ([WC26-LONDON-PRESALE] £878, [WC26-LONDON-ONSALE] £1,684). Spend is
redistributed equally across the 12 fixture cells (3 venues × 4 fixtures):
Tottenham, Shoreditch, Kentish Town (Shepherds Bush is excluded — it has its own
campaigns). After the split, the source synthetic event rows show
`ad_spend_allocated = 0` so the dashboard's `metaPaidSpendOf()` returns £0.

## Scope / files

- `lib/dashboard/wc26-london-split.ts` — new; implements `runWc26LondonSplit()`
  which reads source rollup rows, splits 1/3 per venue × 1/N per fixture, and
  upserts to `event_daily_rollups.ad_spend_allocated`
- `app/api/admin/event-rollup-backfill/route.ts` — wires `runWc26LondonSplit()`
  as a post-processing step in `fourthefansForceBackfill()`; result surfaced in
  the `wc26_london_split` field of the response

## Validation

- [x] `npm test` — 710 pass, 1 skipped, 0 fail
- [ ] Run `POST /api/admin/event-rollup-backfill?force=true` after syncing source events
- [ ] `SELECT * FROM meta_reconcile_event_spend('WC26-LONDON-PRESALE', ...)` — drift reflects all spend attributed
- [ ] Tottenham/Shoreditch/Kentish each show ~£213 per fixture in dashboard
- [ ] Shepherds Bush unchanged

## Notes

- Expected allocation per fixture: £878/12 + £1684/12 ≈ £73.17 + £140.33 = £213.50
- The split is idempotent — re-running produces the same result
- Raw `ad_spend` on source events is preserved for audit; only `ad_spend_allocated` is zeroed
