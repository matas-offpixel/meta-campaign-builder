# Session log

## PR

- **Number:** 292
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/292
- **Branch:** `creator/restore-patterns-phase-funnel-selectors`

## Summary

Restored Creative Insights phase (Registration / Ticket Sale) and funnel (Top / Mid / Bottom) pill selectors with URL params (`phase`, `funnel`), adaptive mini-metrics per funnel, tile sorting by the active funnel metric (with spend tie-break), KPI strip naming the strongest taxonomy dimension by funnel metric, spotlight row for the top three tiles per dimension when more than three exist, performance bars with quartile colouring, and quartile badges with left stripe styling—without changing `lib/reporting/creative-patterns-cross-event.ts`.

## Scope / files

- `lib/dashboard/creative-patterns-funnel-view.ts`
- `components/dashboard/clients/creative-patterns-panel.tsx`
- `components/dashboard/clients/creative-patterns-tiles.tsx`
- `components/dashboard/dashboard-tabs.tsx`
- `app/(dashboard)/clients/[id]/dashboard/page.tsx`
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx`

## Validation

- [x] `npx eslint` on touched paths (run locally after save).
- [ ] `npx tsc --noEmit` (full repo may have unrelated baseline errors).
- [ ] Manual checks per PR goal (dashboard + venue insights URLs).

## Notes

- Public `/share/client/[token]` inherits defaults when `patternsPhase` / `patternsFunnel` are omitted; dashboard URLs always emit `phase` and `funnel` query params on tab/region navigation.
