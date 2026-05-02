## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `feat/dashboard-last-updated-indicator`

## Summary

Adds dashboard freshness indicators so operators can see when ticket and paid-media data were both current on venue cards, full venue reports, and per-event venue rows.

## Scope / files

- `lib/db/client-portal-server.ts` computes per-event freshness from latest rollup timestamps and ticket snapshots filtered to the active ticketing connector.
- `components/share/last-updated-indicator.tsx` centralizes display format, tooltip, and freshness color classes.
- `components/share/client-portal-venue-table.tsx` surfaces venue-level and per-event last-updated labels.
- `components/share/venue-full-report.tsx` surfaces the same indicator on standalone venue reports.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (not run; scoped UI/data change covered by typecheck and tests)
- [x] `npm test`
- [x] `npx eslint "lib/db/client-portal-server.ts" "components/share/client-portal-venue-table.tsx" "components/share/venue-full-report.tsx" "components/share/last-updated-indicator.tsx"`

## Notes

Venue freshness is the minimum `freshness_at` across grouped events; each event freshness is the earlier of its latest ticket snapshot and latest rollup/meta timestamp when both are available.
