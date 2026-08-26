# Session log

## PR

- **Number:** 851
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/851
- **Branch:** `cursor/plan-c1` (stacked on `cursor/plan-e3`)

## Summary

C.1 `client_funnel_benchmarks` migration (158, not applied) plus a read path that returns seed 15/50/5 with provenance `seed` when the table is missing or empty. No learning job.

## Scope / files

- `supabase/migrations/158_client_funnel_benchmarks.sql`
- `lib/dashboard/client-funnel-benchmarks.ts`
- `lib/db/client-funnel-benchmarks-load.ts`
- `app/api/clients/[id]/funnel-benchmarks/route.ts`
- `lib/dashboard/__tests__/client-funnel-benchmarks.test.ts`

## Validation

- [x] `npm test` — 4460 pass, 0 fail, 3 skipped
- [x] eslint clean on touched files
- [x] `npm run build` — includes `/api/clients/[id]/funnel-benchmarks`

## Notes

- Inventory: `event_funnel_overrides` (060) is TOFU/MOFU/BOFU planner rates — different stage model. New table, not an alter.
- Falsification: parent `d264fc3` has no `lib/dashboard/client-funnel-benchmarks.ts`.
