# Session log — funnel pacing cap, scaled targets, LPV from snapshots

## PR

- **Number:** pending
- **URL:** (after `gh pr create`)
- **Branch:** `creator/funnel-pacing-cap-and-scope`

## Summary

Improves client funnel pacing on the dashboard when multiple live events roll up against benchmarks from a single sold-out reference: volume targets scale by live/upcoming event count, BOFU LPV uses summed `active_creatives_snapshots` landing-page views (with a documented click fallback when no snapshot exists), and the pacing cards cap the progress bar at 100% while surfacing clear “ahead / exceeded” copy and badges for strong green pacing.

## Scope / files

- `components/dashboard/clients/funnel-stage-card.tsx` — visual bar cap, ahead/exceeded copy, EXCEEDED badge at ≥130% green
- `lib/reporting/funnel-pacing.ts` — live-event filter (`upcoming` / `on_sale` / `live`), target scaling, snapshot LPV aggregation via service-role snapshot reads
- `lib/reporting/funnel-pacing-payload.ts` — LPV sum helper (testable without `server-only`)
- `lib/reporting/funnel-pacing-derive.ts` — optional per-event LPV map + 0.7× clicks fallback for derived BOFU targets

## Validation

- [x] `npx tsc --noEmit` (no new errors in touched funnel paths)
- [x] `node --experimental-strip-types --test lib/reporting/__tests__/funnel-pacing.test.ts`
- [ ] `/clients/4thefans-id/dashboard?tab=pacing` manual smoke (bars, badges, BOFU ≠ MOFU where snapshots exist)

## Notes

- Raw `pacingPct` on stages remains uncapped for API/export consistency; only the UI caps the bar width.
