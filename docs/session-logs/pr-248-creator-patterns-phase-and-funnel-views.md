## PR

- **Number:** 248
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/248
- **Branch:** `creator/patterns-phase-and-funnel-views`

## Summary

Adds phase and funnel selectors to the internal creative patterns page so operators can filter the underlying concept groups to registration vs ticket-sale campaigns and inspect top, mid, or bottom funnel metrics without changing snapshot payloads.

## Scope / files

- `lib/reporting/creative-patterns-cross-event.ts`
  - Adds render-time phase classification from concept-group campaign names.
  - Applies the selected phase before tag matching and aggregation.
  - Expands tile metrics with CPM, CPC, CPLPV, CPReg, CPP, frequency, LPV, reach, and ROAS placeholder.
  - Logs `[creative-patterns] phase-filter`.
- `app/(dashboard)/dashboard/clients/[slug]/patterns/page.tsx`
  - Parses and persists `phase` and `funnel` URL params.
  - Adds Timeframe | Phase | Funnel pill selectors.
  - Adapts MiniStats, sorting, and best-dimension KPI labels per funnel lens.

## Validation

- [x] `npm run lint -- lib/reporting/creative-patterns-cross-event.ts 'app/(dashboard)/dashboard/clients/[slug]/patterns/page.tsx'`
- [x] `npx tsc --noEmit`

## Notes

Default URL behavior is `phase=ticket_sale&funnel=bottom`, matching the current sales-side bottom-funnel view.
