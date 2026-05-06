# Session log template

Copy to `docs/session-logs/pr-{number}-{branch-slug}.md` (use `pr-pending-{branch-slug}.md` until the PR exists).

## PR

- **Number:** pending
- **URL:** (after `gh pr create`)
- **Branch:** `creator/rollup-sync-presale-and-relaunch-coverage` (target; confirm local branch before PR)

## Summary

Fixes Meta rollup drift by widening Graph `CONTAIN` filters to `[EVENT_CODE` prefixes, bracket post-matching with dash normalisation, and splitting campaign spend into regular vs presale (`partitionMetaSpendForCampaign`). Wires `ad_spend_presale` through `upsertMetaRollups`, extends `runRollupSyncForEvent` with `rollupWindowDays`, restores `metaPaidSpendOf` / client-wide totals for dashboard + share surfaces, adds post-cron reconcile warnings via `meta_reconcile_event_spend` RPC (best-effort param variants), and adds `POST /api/admin/event-rollup-backfill?force=true` (CRON_SECRET) for a 90-day full sync of all 4theFans events.

## Scope / files

- `lib/insights/meta.ts`, `lib/insights/meta-event-code-match.ts`, `lib/insights/meta-campaign-phase.ts`, `lib/insights/types.ts`
- `lib/dashboard/rollup-sync-runner.ts`, `lib/dashboard/paid-spend.ts`, `lib/dashboard/rollup-meta-reconcile-log.ts`
- `lib/db/event-daily-rollups.ts`, `lib/db/client-portal-server.ts`, `lib/db/client-dashboard-aggregations.ts`, `lib/db/database.types.ts`
- `app/api/cron/rollup-sync-events/route.ts`, `app/api/admin/event-rollup-backfill/route.ts`
- Share/report UI: `components/share/client-portal-venue-table.tsx`, `venue-daily-report-block.tsx`, `venue-full-report.tsx`
- Tests: `meta-campaign-phase`, `client-dashboard-aggregations`, `audience-idempotency`, `campaign-videos-route`

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [x] `npm run test -- lib/insights/__tests__/meta-campaign-phase.test.ts`
- [ ] Production: deploy + `POST .../event-rollup-backfill?force=true` + SQL reconcile checks from audit doc

## Notes

- `meta_reconcile_event_spend` SQL unchanged; RPC argument names may need aligning with production if warnings never fire.
- Local branch may differ from target branch name; align with thread rules (`main` → new branch) before opening PR.
