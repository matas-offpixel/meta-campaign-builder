# Session log — daily tier_channel_sales history + smoothed historical backfill

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `feat/tier-channel-sales-daily-history-and-smoothing`

## Summary

Introduces `tier_channel_sales_daily_history` (migration 089), a per-event per-day
cumulative snapshot table that gives the venue trend chart a real day-by-day history,
eliminating the "all tickets land on today" spike that was visible on Manchester WC26 and
any event where tier_channel_sales accumulated before this cron existed.

Three delivery surfaces:
1. **Daily cron** (`/api/cron/snapshot-tier-channel-sales-daily`, 23:55 UTC) — writes
   today's live SUM going forward.
2. **Manual snapshot endpoint** (`/api/admin/snapshot-tier-channel-sales`) — for new
   client onboardings or one-off corrections.
3. **Smoothed backfill endpoint** (`/api/admin/smooth-historical-tier-channel-sales`) —
   distributes historical gap proportionally across a date window using the
   `ticket_sales_snapshots` envelope shape as a prior. Run once per affected event after
   migration lands.

The resolver (`buildEventCumulativeTicketTimeline`) now prioritises daily_history rows over
the snapshot envelope for their dates. `source_kind = 'smoothed_historical'` rows are
tagged `isSmoothed` so the trend chart tooltip shows a muted "(est.)" indicator.

## Scope / files

- `supabase/migrations/089_tier_channel_sales_daily_history.sql` — new table + RLS
- `lib/db/tier-channel-daily-history.ts` — CRUD helpers
- `lib/dashboard/tier-channel-smoothing.ts` — pure proportional smoothing algorithm
- `app/api/cron/snapshot-tier-channel-sales-daily/route.ts` — nightly cron
- `app/api/admin/snapshot-tier-channel-sales/route.ts` — manual backfill
- `app/api/admin/smooth-historical-tier-channel-sales/route.ts` — one-shot historical smoothing
- `vercel.json` — added `55 23 * * *` cron schedule
- `lib/dashboard/venue-trend-points.ts` — resolver updated; `dailyHistory` param + `isSmoothed` tag
- `lib/dashboard/trend-chart-data.ts` — `ticketsSmoothed` field on `TrendChartPoint` / `TrendChartDay`; carry-forward propagates the flag
- `components/dashboard/events/event-trend-chart.tsx` — "(est.)" tooltip indicator
- `lib/db/client-portal-server.ts` — fetch daily_history; added `trendDailyHistory` to `ClientPortalData`
- `components/share/venue-daily-report-block.tsx` — thread `dailyHistory` through model builder
- `components/share/venue-full-report.tsx` — `trendDailyHistory` prop
- `components/share/client-portal.tsx` — `trendDailyHistory` prop
- `components/share/client-portal-venue-table.tsx` — `trendDailyHistory` prop + `VenueSection` wiring
- `components/dashboard/dashboard-tabs.tsx` — `trendDailyHistory` prop
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — pass new prop
- `app/(dashboard)/clients/[id]/dashboard/page.tsx` — pass new prop
- `app/share/venue/[token]/page.tsx` — pass new prop
- `app/share/client/[token]/page.tsx` — pass new prop
- `lib/dashboard/__tests__/tier-channel-smoothing.test.ts` — 15 unit tests

## Validation

- [x] `npm run build` — clean
- [x] `npm test` — 916/916 pass (1 pre-existing skip)
- [x] `npm run lint` — 0 new errors (64 pre-existing unchanged)

## Notes

**After-merge runbook:**

1. Apply migration 089 in Supabase dashboard (or `supabase db push`).
2. Verify cron visible in Vercel dashboard (should auto-register from `vercel.json`).
3. For each affected event (Manchester WC26 × 4, CL Final London × 4):
   a. `POST /api/admin/snapshot-tier-channel-sales { "eventId": "<uuid>" }` — captures today's real SUM.
   b. `POST /api/admin/smooth-historical-tier-channel-sales { "eventId": "<uuid>", "fromDate": "2026-04-09", "toDate": "2026-05-08" }` — backfills historical window.
4. Hard refresh `/clients/37906506-56b7-4d58-ab62-1b042e2b561a/venues/WC26-MANCHESTER`.
   Expect: smooth upward trend Apr 9 → today, no May 9 spike, "(est.)" on smoothed days.

**Design notes:**
- The cron writes today's date only; smoothed_historical rows are for past dates — the two
  source_kinds never collide on (event_id, snapshot_date).
- Future new-client onboardings: run the snapshot endpoint once to seed today's baseline,
  then optionally run the smooth endpoint for any historical window you want to clean up.
  After that, daily cron takes over automatically.
- `ticketsSmoothed` carry-forward is intentional: once a day is marked "(est.)", all
  subsequent carry-forward days share the flag until a real cron snapshot arrives (which
  is not smoothed). This gives operators a clear "data before cron / data after cron" boundary.
