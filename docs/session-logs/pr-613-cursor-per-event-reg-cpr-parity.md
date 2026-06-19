# Session log

## PR

- **Number:** 613
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/613
- **Branch:** `cursor/per-event-reg-cpr-parity`

## Summary

Per-event Reporting tab now mirrors the IRWOHD always-on layout for Registrations + CPR. Three changes shipped together: the Tickets card gains a Revenue sub-line (removing the now-redundant CPT line); a new REGISTRATIONS card (4th slot) shows subscriber count headline + CPR sub-line for events with `mailchimp_tag` set; the Daily Trend chart gains Registrations and CPR pill series sourced from daily Mailchimp tag snapshots with carry-forward semantics.

## Scope / files

- `components/report/event-report-view.tsx` — Tickets card: add Revenue sub-line, remove CPT line. REGISTRATIONS card: flip headline from CPR to subscriber count, CPR as sub-line.
- `components/report/internal-event-report.tsx` — Compute `ticketRevenue` from rollup timeline; pass to `EventReportView`.
- `components/dashboard/events/event-trend-chart.tsx` — Extend `MetricKey` + `METRICS` with `registrations` + `cpr`. `LegacyTrendChart` accepts `mailchimpSnapshots`, builds carry-forward day map, renders Registrations/CPR pill series conditionally when snapshots are available.
- `components/dashboard/events/event-daily-report-block.tsx` — Add `mailchimpTag` to `EventLike`; fetch raw snapshot rows from API on mount for non-brand_campaign events with a tag; pass to `EventTrendChart`.
- `components/dashboard/events/event-detail.tsx` — Pass `mailchimpTag` to `EventDailyReportBlock`.
- `app/api/events/[id]/mailchimp/snapshots/route.ts` — Extend response to include `rows: MailchimpSnapshotRow[]` for chart use.

## Validation

- [x] `npm run build` — passes cleanly (0 errors, 0 new warnings in changed files)
- [x] `npx eslint` on all changed files — 0 errors, 3 pre-existing warnings only

## Notes

- For Camelphat (IRW0004) to show Registrations + CPR, `mailchimp_tag` must be set on the event in Supabase (`UPDATE events SET mailchimp_tag = 'Camelphat - London' WHERE event_code = 'IRW0004';`). The tag snapshot cron must also have run at least once.
- The Tickets card no longer shows CPT — this is an intentional trade-off to make room for revenue and to keep the card focused. CPT is still visible in the EventSummaryHeader pacing table.
- The chart Registrations + CPR pills only appear when mailchimp snapshot rows are fetched successfully; they remain hidden for events without a tag.
