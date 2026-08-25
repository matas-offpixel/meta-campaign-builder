# Session log

## PR

- **Number:** 840
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/840
- **Branch:** `cursor/lp-pageview-capture`

## Summary

Phase B instrumentation: first-party landing-page-view capture on `/l`. Beacon POSTs to `/api/l/{slug}/{slug}/view`, stored in `lp_page_views` (no PII). The #837 helper counts rows at read time so the LPV stage and cost-per-LPV flip from "not instrumented" to first-party without UI changes.

## Scope / files

- `supabase/migrations/155_lp_page_views.sql` — applied on prod (`20260825213903`)
- `lib/landing-pages/page-view-handler.ts` + beacon + rate limit
- `app/api/l/[clientSlug]/[eventSlug]/view/route.ts`
- `lib/dashboard/event-funnel.ts` + `lib/db/event-funnel-load.ts` — read-time COUNT

## Validation

- [x] `npm run build` (`/api/l/[clientSlug]/[eventSlug]/view` in the route table)
- [x] `npm test` — 4361 tests, 4358 pass, 0 fail, 3 skipped
- [x] Migration 155 applied (`20260825213903` / `155_lp_page_views`); RLS on, 2 SELECT policies, 9 columns

## Notes

- Rollup choice: **read-time COUNT on `lp_page_views`**, not a new `event_daily_rollups` column. The helper already counts `event_signups` that way; rollup-sync does not own this pipe.
- Metric labelled "page views (unfiltered)".
- Follow-up: B.1 wizard LP creation; click-ID joins; operator Slack unused here.
