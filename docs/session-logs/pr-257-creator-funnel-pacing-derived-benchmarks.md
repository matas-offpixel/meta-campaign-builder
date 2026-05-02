## PR

- **Number:** 257
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/257
- **Branch:** `creator/funnel-pacing-derived-benchmarks`

## Summary

Fills in the Funnel Pacing sub-tab with auto-derived benchmark targets from sold-out events, stage-level pacing cards, and a nightly refresh cron.

## Scope / files

- `supabase/migrations/069_event_funnel_targets.sql`
  - Adds `event_funnel_targets` with owner-scoped RLS.
- `lib/reporting/funnel-pacing-derive.ts`
  - Pure derivation logic for sold-out event benchmark averages.
- `lib/reporting/funnel-pacing.ts`
  - Server-side loading, target creation, current rollup aggregation, and cron refresh helper.
- `components/dashboard/clients/funnel-pacing-section.tsx`
  - Header/source strip and four-stage pacing layout.
- `components/dashboard/clients/funnel-stage-card.tsx`
  - TOFU/MOFU/BOFU/Sale stage card.
- `components/dashboard/clients/funnel-creative-pacing.tsx`
  - Placeholder expandable per-creative overlay.
- `app/api/cron/funnel-pacing-refresh/route.ts`
  - Nightly refresh endpoint guarded by `CRON_SECRET`.
- `vercel.json`
  - Adds `0 3 * * *` cron schedule.

## Validation

- [x] `node --experimental-strip-types --test lib/reporting/__tests__/funnel-pacing-derive.test.ts`
- [x] `npm run lint -- 'app/(dashboard)/clients/[id]/dashboard/page.tsx' 'app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx' app/api/cron/funnel-pacing-refresh/route.ts components/dashboard/clients/funnel-pacing-section.tsx components/dashboard/clients/funnel-stage-card.tsx components/dashboard/clients/funnel-creative-pacing.tsx lib/reporting/funnel-pacing.ts lib/reporting/funnel-pacing-derive.ts lib/reporting/__tests__/funnel-pacing-derive.test.ts`
- [x] `npx tsc --noEmit`
- [ ] Migration 069 not applied from this session; Supabase MCP is not available in this tool environment.

## Notes

`event_daily_rollups` does not currently expose a first-class LPV column. This implementation uses link clicks as the conservative LPV proxy for derived BOFU targets until the rollup model widens.
