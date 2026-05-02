## PR

- **Number:** 237
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/237
- **Branch:** `creator/tag-breakdown-tile-grid`

## Summary

Replaces the per-event creative tag breakdown table with a tile-grid plus collapsed details table so share and dashboard reports are easier to browse while keeping the same render-time snapshot-plus-assignment data flow.

## Scope / files

- `components/share/share-creative-tag-breakdowns.tsx` renders the tile grid, thumbnail collage/fallback tiles, and collapsed numerical table.
- `lib/reporting/creative-tag-breakdowns.ts` now limits per-event dimensions to the trusted Motion set and builds tile data from concept groups plus assignments.
- `lib/db/creative-tags.ts` includes `value_key` on assignment tag joins for stable tile/table joins.
- `components/dashboard/events/event-active-creatives-panel.tsx` and `app/api/insights/event/[eventId]/tag-breakdowns/route.ts` pass assignments through for dashboard tile rendering.
- `lib/reporting/__tests__/creative-tag-breakdowns.test.ts` covers the tile join, top-thumbnail ordering, fallback tile behavior, and hidden low-trust dimensions.

## Validation

- [x] `npm run lint -- components/share/share-creative-tag-breakdowns.tsx lib/reporting/creative-tag-breakdowns.ts lib/reporting/__tests__/creative-tag-breakdowns.test.ts lib/db/creative-tags.ts app/api/insights/event/[eventId]/tag-breakdowns/route.ts components/dashboard/events/event-active-creatives-panel.tsx`
- [x] `npx tsc --noEmit`
- [x] `node --experimental-strip-types --test lib/reporting/__tests__/creative-tag-breakdowns.test.ts`
- [x] `npm test`
- [x] Vercel preview `/share/report/i6MRF2-I789FSxdY` renders tile cards and collapsed details for available trusted tag dimensions.
- [x] Vercel preview `/share/report/Rul8DeLZBVTZ0kZr` renders the awareness active-creatives section and hides tag breakdowns because there are no matching assignments for that event.
- [x] Vercel preview `/share/venue/wI2XvJF0t-XzMi59` does not render the tag performance section.

## Notes

Local `next dev` could not reach the share URLs because the current app route tree has an existing dynamic slug conflict under `app/api/events/[id]` and `app/api/events/[eventId]`. Vercel preview covered the requested share URL regressions. The tile join may surface fewer creatives until the duplicate event rows Phase 5 dedupe lands, matching the 2026-05-02 duplicate-events finding.
