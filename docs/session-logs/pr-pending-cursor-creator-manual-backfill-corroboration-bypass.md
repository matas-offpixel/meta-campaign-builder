# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creator/manual-backfill-corroboration-bypass`

## Summary

Fixed the "Daily Trend" chart showing zero tickets for manual-only clients (J2 Melodic, event `42b5673a`). The `corroboratedDailyDeltas` function required `event_daily_rollups.tickets_sold` activity within ±1 day to surface any cumulative delta as a real sale. For clients with no API ticketing connection, all rollup rows have `tickets_sold = null`, so the activity set was always empty and every delta was suppressed. Added a `MANUAL_SOURCE_KINDS` bypass: history rows with `source_kind = 'manual_backfill'` emit their deltas directly without requiring rollup corroboration. `cron` and `smoothed_historical` source kinds retain the full gate so phantom reconciliation jumps remain suppressed for API-connected clients.

## Scope / files

- `lib/dashboard/venue-trend-points.ts` — `MANUAL_SOURCE_KINDS` constant; `manualBypassDates` option in `CorroboratedDeltaOptions`; bypass logic in `corroboratedDailyDeltas`; `historyRows` param in `buildCorroboratedDailyDeltas`
- `lib/db/event-daily-timeline.ts` — pass `dailyHistory` as `historyRows` to `buildCorroboratedDailyDeltas`
- `components/share/venue-daily-report-block.tsx` — add `historyRows` param to `mergeVenueTimeline`; thread `options?.dailyHistory` through call site
- `lib/dashboard/__tests__/corroborated-daily-deltas.test.ts` — 3 new suites (J2 Melodic manual_backfill bypass, 4thefans cron regression, mixed source_kinds); 22/22 passing

## Validation

- [x] 22/22 unit tests passing (`node --experimental-strip-types --test`)
- [x] No lint errors in modified files
- [ ] `npm run build` (Vercel CI)

## Notes

- DB query confirmed only 3 distinct `source_kind` values exist: `cron`, `manual_backfill`, `smoothed_historical`. `MANUAL_SOURCE_KINDS` is a `Set` so adding future manual variants is a one-line change.
- The `daily_tracking_entries` path (operator per-day typed entries) was already fully bypassed — it lives in its own merge loop and never hits the corroboration gate. The fix mirrors that existing pattern at the history-row level.
- Post-merge: reload J2 Melodic event report to verify ticket curve 211 → 1,681 from 9 Feb to 25 May; toggle Weekly for 16 aggregated points; verify 4thefans Brighton/Central Park unaffected.
