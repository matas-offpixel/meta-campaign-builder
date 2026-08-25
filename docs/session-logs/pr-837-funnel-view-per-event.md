# Session log

## PR

- **Number:** 837
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/837
- **Branch:** `cursor/funnel-view-per-event`

## Summary

Phase A.1 of the funnel-first engine roadmap: a per-event funnel on the event report (internal + share) with reach → clicks → LPV → signups → purchases, seed-rate comparison, per-platform split on the top stages, and a provenance badge on every stage. LPV is an explicit "not instrumented — Phase B" state. Purchases read the restored rollup tickets leg (#836).

## Scope / files

- `lib/dashboard/event-funnel.ts` — pure builder + 15/50/5 seeds
- `lib/db/event-funnel-load.ts` — lifetime rollup / signup / snapshot-source load
- `components/dashboard/event-report/event-funnel-card.tsx`
- `app/api/events/[id]/funnel/route.ts`
- Wired through `EventReportView`, `InternalEventReport`, `PublicReport`, share RSC

## Validation

- [x] Regression test fails without the module (`Cannot find module '../event-funnel.ts'`)
- [x] `npm test` — 4318 tests, 4315 pass, 0 fail, 3 skipped
- [x] `npx eslint` on changed files (no new errors)
- [x] `npm run build`

## Notes

- Did not use Meta `landing_page_views` as the LPV stage (platform action ≠ first-party LP).
- Google reach is "not tracked" (no `google_ads_reach` column).
- Per-day ticket source is not on rollups; event-level label from distinct snapshot sources.
